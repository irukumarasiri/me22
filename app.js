import { firebaseConfig, bootstrapAdminEmails } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const REQUIRED_BATCHES = ["22", "23", "24", "25"];
const state = {
  appReady: false,
  user: null,
  userRole: "guest",
  activeEventId: null,
  activeBatch: "22",
  events: [],
};

const els = {
  authStatus: document.querySelector("#authStatus"),
  loginBtn: document.querySelector("#loginBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
  configWarning: document.querySelector("#configWarning"),
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  adminOnly: document.querySelectorAll(".admin-only"),
  searchForm: document.querySelector("#searchForm"),
  searchIndex: document.querySelector("#searchIndex"),
  searchResults: document.querySelector("#searchResults"),
  eventForm: document.querySelector("#eventForm"),
  eventTitle: document.querySelector("#eventTitle"),
  eventDate: document.querySelector("#eventDate"),
  eventDescription: document.querySelector("#eventDescription"),
  refreshEventsBtn: document.querySelector("#refreshEventsBtn"),
  eventsList: document.querySelector("#eventsList"),
  activeEventTitle: document.querySelector("#activeEventTitle"),
  activeEventMeta: document.querySelector("#activeEventMeta"),
  attendanceTools: document.querySelector("#attendanceTools"),
  batchChips: document.querySelectorAll(".batch-chip"),
  indexPrefix: document.querySelector("#indexPrefix"),
  attendanceInputLabel: document.querySelector("#attendanceInputLabel"),
  attendanceForm: document.querySelector("#attendanceForm"),
  attendanceIndex: document.querySelector("#attendanceIndex"),
  markFeedback: document.querySelector("#markFeedback"),
  attendanceCount: document.querySelector("#attendanceCount"),
  attendanceList: document.querySelector("#attendanceList"),
  importForm: document.querySelector("#importForm"),
  importBatch: document.querySelector("#importBatch"),
  studentFile: document.querySelector("#studentFile"),
  importResults: document.querySelector("#importResults"),
  customStudentForm: document.querySelector("#customStudentForm"),
  customName: document.querySelector("#customName"),
  customIndex: document.querySelector("#customIndex"),
  refreshStudentsBtn: document.querySelector("#refreshStudentsBtn"),
  studentsList: document.querySelector("#studentsList"),
  toast: document.querySelector("#toast"),
};

let auth;
let db;

boot();

function boot() {
  const missingConfig = Object.values(firebaseConfig).some((value) => String(value).startsWith("PASTE_"));
  if (missingConfig) {
    els.configWarning.classList.remove("hidden");
    els.authStatus.textContent = "Firebase setup needed";
    wireStaticHandlers();
    return;
  }

  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  state.appReady = true;

  wireStaticHandlers();
  getRedirectResult(auth).catch((error) => showToast(error.message, "error"));
  onAuthStateChanged(auth, handleAuthChange);
}

function wireStaticHandlers() {
  els.tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
  els.loginBtn.addEventListener("click", signIn);
  els.logoutBtn.addEventListener("click", () => signOut(auth));
  els.searchForm.addEventListener("submit", searchAttendance);
  els.eventForm.addEventListener("submit", createEvent);
  els.refreshEventsBtn.addEventListener("click", loadEvents);
  els.batchChips.forEach((chip) => chip.addEventListener("click", () => setActiveBatch(chip.dataset.batch)));
  els.attendanceForm.addEventListener("submit", markAttendance);
  els.importForm.addEventListener("submit", importStudents);
  els.customStudentForm.addEventListener("submit", addCustomStudent);
  els.refreshStudentsBtn.addEventListener("click", loadRecentStudents);

  const today = new Date().toISOString().slice(0, 10);
  els.eventDate.value = today;
  setActiveBatch("22");
}

async function signIn() {
  if (!state.appReady) {
    showToast("Add Firebase settings before signing in.", "error");
    return;
  }

  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (["auth/popup-blocked", "auth/cancelled-popup-request"].includes(error.code)) {
      await signInWithRedirect(auth, provider);
      return;
    }
    showToast(error.message, "error");
  }
}

async function handleAuthChange(user) {
  state.user = user;
  state.userRole = "guest";

  if (!user) {
    els.authStatus.textContent = "Not signed in";
    els.loginBtn.classList.remove("hidden");
    els.logoutBtn.classList.add("hidden");
    setAdminVisible(false);
    showView("searchView");
    return;
  }

  const normalizedEmail = user.email.toLowerCase();
  const bootstrapAdmin = bootstrapAdminEmails.map((email) => email.toLowerCase()).includes(normalizedEmail);
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
  const existingRole = userSnap.exists() ? userSnap.data().role : null;
  const role = existingRole || (bootstrapAdmin ? "admin" : "user");

  await setDoc(
    userRef,
    {
      email: user.email,
      displayName: user.displayName || "",
      photoURL: user.photoURL || "",
      role,
      updatedAt: serverTimestamp(),
      createdAt: userSnap.exists() ? userSnap.data().createdAt : serverTimestamp(),
    },
    { merge: true },
  );

  state.userRole = role;
  els.authStatus.textContent = `${user.displayName || user.email} · ${role}`;
  els.loginBtn.classList.add("hidden");
  els.logoutBtn.classList.remove("hidden");
  setAdminVisible(role === "admin");

  if (role === "admin") {
    await Promise.all([loadEvents(), loadRecentStudents()]);
  }
}

function setAdminVisible(isAdmin) {
  els.adminOnly.forEach((node) => node.classList.toggle("hidden", !isAdmin));
}

function requireAdmin() {
  if (!state.appReady) {
    showToast("Firebase is not configured yet.", "error");
    return false;
  }
  if (!state.user || state.userRole !== "admin") {
    showToast("Admin access is required for this action.", "error");
    return false;
  }
  return true;
}

function showView(viewId) {
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === viewId));
  els.views.forEach((view) => view.classList.toggle("active", view.id === viewId));
}

async function createEvent(event) {
  event.preventDefault();
  if (!requireAdmin()) return;

  const eventId = crypto.randomUUID();
  const title = els.eventTitle.value.trim();
  const description = els.eventDescription.value.trim();
  const eventDate = els.eventDate.value;

  await setDoc(doc(db, "events", eventId), {
    title,
    description,
    eventDate,
    createdAt: serverTimestamp(),
    createdByUid: state.user.uid,
    createdByEmail: state.user.email,
  });

  els.eventForm.reset();
  els.eventDate.value = new Date().toISOString().slice(0, 10);
  showToast("Event created.");
  await loadEvents();
  selectEvent(eventId);
}

async function loadEvents() {
  if (!requireAdmin()) return;

  const eventsQuery = query(collection(db, "events"), orderBy("eventDate", "desc"), limit(40));
  const snap = await getDocs(eventsQuery);
  state.events = snap.docs.map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() }));

  if (!state.events.length) {
    els.eventsList.innerHTML = `<p class="empty">No events yet. Create the first event above.</p>`;
    return;
  }

  els.eventsList.innerHTML = state.events
    .map(
      (item) => `
        <button class="list-row event-row" type="button" data-event-id="${escapeHtml(item.id)}">
          <span>
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(formatDate(item.eventDate))} · ${escapeHtml(item.createdByEmail || "Unknown creator")}</small>
          </span>
        </button>
      `,
    )
    .join("");

  els.eventsList.querySelectorAll(".event-row").forEach((row) => {
    row.addEventListener("click", () => selectEvent(row.dataset.eventId));
  });
}

async function selectEvent(eventId) {
  state.activeEventId = eventId;
  const item = state.events.find((eventItem) => eventItem.id === eventId);
  els.activeEventTitle.textContent = item?.title || "Selected event";
  els.activeEventMeta.textContent = item ? `${formatDate(item.eventDate)} · ${item.description || "No description"}` : "";
  els.attendanceTools.classList.remove("hidden");
  await loadAttendance();
}

function setActiveBatch(batch) {
  state.activeBatch = batch;
  els.batchChips.forEach((chip) => chip.classList.toggle("active", chip.dataset.batch === batch));
  const isOther = batch === "other";
  els.indexPrefix.textContent = isOther ? "ID" : batch;
  els.indexPrefix.classList.toggle("muted-prefix", isOther);
  els.attendanceInputLabel.firstChild.textContent = isOther ? "Full custom ID" : "Index suffix";
  els.attendanceIndex.placeholder = isOther ? "VOLUNTEER01" : "0062D";
  els.attendanceIndex.value = "";
  els.attendanceIndex.focus();
}

async function markAttendance(event) {
  event.preventDefault();
  if (!requireAdmin() || !state.activeEventId) return;

  const typed = els.attendanceIndex.value;
  const indexNumber = state.activeBatch === "other" ? normalizeIndex(typed) : normalizeIndex(`${state.activeBatch}${typed}`);

  if (!indexNumber) {
    setMarkFeedback("Enter a valid index number or custom ID.", "error");
    return;
  }

  const studentRef = doc(db, "students", indexNumber);
  const studentSnap = await getDoc(studentRef);
  if (!studentSnap.exists()) {
    setMarkFeedback(`${indexNumber} is not in the student list. Add it in Students first.`, "error");
    return;
  }

  const student = studentSnap.data();
  await setDoc(doc(db, "events", state.activeEventId, "attendance", indexNumber), {
    indexNumber,
    studentName: student.name,
    batch: student.batch || "other",
    category: student.category || "batch",
    markedAt: serverTimestamp(),
    markedByUid: state.user.uid,
    markedByEmail: state.user.email,
  });

  els.attendanceIndex.value = "";
  setMarkFeedback(`${student.name} marked present.`, "success");
  await loadAttendance();
}

async function loadAttendance() {
  if (!state.activeEventId) return;

  const snap = await getDocs(collection(db, "events", state.activeEventId, "attendance"));
  const rows = snap.docs
    .map((attendanceDoc) => ({ id: attendanceDoc.id, ...attendanceDoc.data() }))
    .sort((a, b) => String(a.indexNumber).localeCompare(String(b.indexNumber)));

  els.attendanceCount.textContent = String(rows.length);
  if (!rows.length) {
    els.attendanceList.innerHTML = `<p class="empty">No one has been marked yet.</p>`;
    return;
  }

  els.attendanceList.innerHTML = rows
    .map(
      (row) => `
        <div class="list-row">
          <span>
            <strong>${escapeHtml(row.indexNumber)}</strong>
            <small>${escapeHtml(row.studentName || "Unknown")} · ${escapeHtml(row.batch || "other")}</small>
          </span>
          <button class="btn danger small" type="button" data-remove="${escapeHtml(row.indexNumber)}">Remove</button>
        </div>
      `,
    )
    .join("");

  els.attendanceList.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      await deleteDoc(doc(db, "events", state.activeEventId, "attendance", button.dataset.remove));
      showToast("Attendance entry removed.");
      await loadAttendance();
    });
  });
}

async function importStudents(event) {
  event.preventDefault();
  if (!requireAdmin()) return;

  const file = els.studentFile.files[0];
  if (!file || !window.XLSX) {
    showToast("Choose an Excel file first.", "error");
    return;
  }

  const batch = els.importBatch.value;
  const data = await file.arrayBuffer();
  const workbook = window.XLSX.read(data);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });
  const students = parseStudentRows(rows, batch);

  if (!students.length) {
    renderImportResult("No valid student rows found.", []);
    return;
  }

  await Promise.all(
    students.map((student) =>
      setDoc(
        doc(db, "students", student.indexNumber),
        {
          ...student,
          updatedAt: serverTimestamp(),
          importedByUid: state.user.uid,
          importedByEmail: state.user.email,
        },
        { merge: true },
      ),
    ),
  );

  renderImportResult(`Imported ${students.length} students for ${batch} batch.`, students.slice(0, 8));
  els.importForm.reset();
  els.importBatch.value = batch;
  await loadRecentStudents();
}

function parseStudentRows(rows, fallbackBatch) {
  const firstRow = rows[0] || [];
  const hasHeader = firstRow.some((cell) => /name|index|batch/i.test(String(cell || "")));
  const headers = hasHeader ? firstRow.map((cell) => String(cell || "").toLowerCase()) : [];
  const body = hasHeader ? rows.slice(1) : rows;
  const nameIndex = hasHeader ? findHeader(headers, ["name", "student"]) : 0;
  const indexIndex = hasHeader ? findHeader(headers, ["index", "registration", "reg"]) : 1;
  const batchIndex = hasHeader ? findHeader(headers, ["batch"]) : -1;
  const seen = new Set();

  return body
    .map((row) => {
      const name = String(row[nameIndex] || "").trim().replace(/\s+/g, " ");
      const indexNumber = normalizeIndex(row[indexIndex]);
      const detectedBatch = REQUIRED_BATCHES.includes(indexNumber.slice(0, 2)) ? indexNumber.slice(0, 2) : fallbackBatch;
      const batch = String(row[batchIndex] || detectedBatch || fallbackBatch).slice(0, 2);
      return { name, indexNumber, batch, category: "batch" };
    })
    .filter((student) => {
      const valid = student.name && student.indexNumber && !seen.has(student.indexNumber);
      seen.add(student.indexNumber);
      return valid;
    });
}

function findHeader(headers, candidates) {
  return headers.findIndex((header) => candidates.some((candidate) => header.includes(candidate)));
}

function renderImportResult(message, students) {
  els.importResults.innerHTML = `
    <div class="notice success">
      <strong>${escapeHtml(message)}</strong>
      ${
        students.length
          ? `<ul>${students
              .map((student) => `<li>${escapeHtml(student.indexNumber)} · ${escapeHtml(student.name)}</li>`)
              .join("")}</ul>`
          : ""
      }
    </div>
  `;
}

async function addCustomStudent(event) {
  event.preventDefault();
  if (!requireAdmin()) return;

  const name = els.customName.value.trim().replace(/\s+/g, " ");
  const indexNumber = normalizeIndex(els.customIndex.value);
  if (!name || !indexNumber) {
    showToast("Name and custom ID are required.", "error");
    return;
  }

  await setDoc(
    doc(db, "students", indexNumber),
    {
      name,
      indexNumber,
      batch: "other",
      category: "custom",
      updatedAt: serverTimestamp(),
      createdByUid: state.user.uid,
      createdByEmail: state.user.email,
    },
    { merge: true },
  );

  els.customStudentForm.reset();
  showToast("Custom person added.");
  await loadRecentStudents();
}

async function loadRecentStudents() {
  if (!requireAdmin()) return;

  const snap = await getDocs(query(collection(db, "students"), orderBy("updatedAt", "desc"), limit(30)));
  const rows = snap.docs.map((studentDoc) => studentDoc.data());
  els.studentsList.innerHTML = rows.length
    ? rows
        .map(
          (student) => `
            <div class="list-row">
              <span>
                <strong>${escapeHtml(student.indexNumber)}</strong>
                <small>${escapeHtml(student.name)} · ${escapeHtml(student.batch || "other")}</small>
              </span>
            </div>
          `,
        )
        .join("")
    : `<p class="empty">No student records yet.</p>`;
}

async function searchAttendance(event) {
  event.preventDefault();
  if (!state.appReady) {
    els.searchResults.innerHTML = `<div class="notice warning">Firebase is not configured yet.</div>`;
    return;
  }

  const indexNumber = normalizeIndex(els.searchIndex.value);
  if (!indexNumber) {
    els.searchResults.innerHTML = `<div class="notice warning">Enter an index number first.</div>`;
    return;
  }

  els.searchResults.innerHTML = `<div class="notice">Searching...</div>`;
  const studentSnap = await getDoc(doc(db, "students", indexNumber));
  const attendanceSnap = await getDocs(query(collectionGroup(db, "attendance"), where("indexNumber", "==", indexNumber)));
  const attendances = attendanceSnap.docs.map((attendanceDoc) => ({
    id: attendanceDoc.id,
    eventId: attendanceDoc.ref.parent.parent.id,
    ...attendanceDoc.data(),
  }));
  const events = await Promise.all(attendances.map((item) => getDoc(doc(db, "events", item.eventId))));

  const eventRows = events
    .filter((eventSnap) => eventSnap.exists())
    .map((eventSnap) => ({ id: eventSnap.id, ...eventSnap.data() }))
    .sort((a, b) => String(b.eventDate).localeCompare(String(a.eventDate)));

  const student = studentSnap.exists() ? studentSnap.data() : null;
  els.searchResults.innerHTML = `
    <section class="panel result-card">
      <div class="stat-row">
        <span>
          <strong>${escapeHtml(indexNumber)}</strong>
          <small>${escapeHtml(student?.name || "No student record found")}</small>
        </span>
        <span class="big-count">${eventRows.length}</span>
      </div>
      <p class="muted">${eventRows.length === 1 ? "event attended" : "events attended"}</p>
      ${
        eventRows.length
          ? `<div class="item-list">${eventRows
              .map(
                (item) => `
                  <div class="list-row">
                    <span>
                      <strong>${escapeHtml(item.title)}</strong>
                      <small>${escapeHtml(formatDate(item.eventDate))}</small>
                    </span>
                  </div>
                `,
              )
              .join("")}</div>`
          : `<p class="empty">No attendance has been marked for this index yet.</p>`
      }
    </section>
  `;
}

function normalizeIndex(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function setMarkFeedback(message, type) {
  els.markFeedback.textContent = message;
  els.markFeedback.className = `inline-feedback ${type || ""}`;
}

function showToast(message, type = "success") {
  els.toast.textContent = message;
  els.toast.className = `toast ${type}`;
  window.setTimeout(() => els.toast.classList.add("hidden"), 3600);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
