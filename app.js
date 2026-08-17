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
  authNotice: document.querySelector("#authNotice"),
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  adminOnly: document.querySelectorAll(".admin-only"),
  refreshPublicEventsBtn: document.querySelector("#refreshPublicEventsBtn"),
  publicEventsList: document.querySelector("#publicEventsList"),
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
  downloadEventAttendanceBtn: document.querySelector("#downloadEventAttendanceBtn"),
  restoreEventAttendanceForm: document.querySelector("#restoreEventAttendanceForm"),
  eventAttendanceBackupFile: document.querySelector("#eventAttendanceBackupFile"),
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
  downloadFullBackupBtn: document.querySelector("#downloadFullBackupBtn"),
  restoreFullBackupForm: document.querySelector("#restoreFullBackupForm"),
  fullBackupFile: document.querySelector("#fullBackupFile"),
  downloadStudentsBackupBtn: document.querySelector("#downloadStudentsBackupBtn"),
  restoreStudentsBackupForm: document.querySelector("#restoreStudentsBackupForm"),
  studentsBackupFile: document.querySelector("#studentsBackupFile"),
  backupResults: document.querySelector("#backupResults"),
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
  loadPublicRecentEvents().catch((error) => {
    console.warn("Could not load public recent events.", error);
    renderPublicEventsError("Recent events could not be loaded. Check Firestore rules if this continues.");
  });
  getRedirectResult(auth).catch((error) => showAuthError(error));
  onAuthStateChanged(auth, (user) => {
    handleAuthChange(user).catch((error) => showAuthError(error));
  });
}

function wireStaticHandlers() {
  els.tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
  els.loginBtn.addEventListener("click", signIn);
  els.logoutBtn.addEventListener("click", () => signOut(auth));
  els.refreshPublicEventsBtn.addEventListener("click", () => {
    loadPublicRecentEvents().catch((error) => {
      console.warn("Could not refresh public recent events.", error);
      renderPublicEventsError("Recent events could not be refreshed.");
    });
  });
  els.searchForm.addEventListener("submit", searchAttendance);
  els.eventForm.addEventListener("submit", createEvent);
  els.refreshEventsBtn.addEventListener("click", loadEvents);
  els.batchChips.forEach((chip) => chip.addEventListener("click", () => setActiveBatch(chip.dataset.batch)));
  els.attendanceForm.addEventListener("submit", markAttendance);
  els.downloadEventAttendanceBtn.addEventListener("click", downloadActiveEventAttendance);
  els.restoreEventAttendanceForm.addEventListener("submit", restoreActiveEventAttendance);
  els.importForm.addEventListener("submit", importStudents);
  els.customStudentForm.addEventListener("submit", addCustomStudent);
  els.refreshStudentsBtn.addEventListener("click", loadRecentStudents);
  els.downloadFullBackupBtn.addEventListener("click", downloadFullBackup);
  els.restoreFullBackupForm.addEventListener("submit", restoreFullBackup);
  els.downloadStudentsBackupBtn.addEventListener("click", downloadStudentsBackup);
  els.restoreStudentsBackupForm.addEventListener("submit", restoreStudentsBackup);

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
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (error.code === "auth/popup-closed-by-user") {
      showAuthMessage("The Google sign-in window closed before Firebase completed login. Try again and wait for this page to update.");
      return;
    }

    if (shouldUseRedirectFallback(error)) {
      showAuthMessage("Popup sign-in did not complete. Switching to full-page Google sign-in...");
      await signInWithRedirect(auth, provider);
      return;
    }

    showAuthError(error);
  }
}

async function handleAuthChange(user) {
  state.user = user;
  state.userRole = "guest";
  hideAuthMessage();

  if (!user) {
    els.authStatus.textContent = "Not signed in";
    els.loginBtn.classList.remove("hidden");
    els.logoutBtn.classList.add("hidden");
    setAdminVisible(false);
    showView("searchView");
    return;
  }

  els.authStatus.textContent = `${user.displayName || user.email} · checking access`;
  els.loginBtn.classList.add("hidden");
  els.logoutBtn.classList.remove("hidden");

  const normalizedEmail = user.email.toLowerCase();
  const bootstrapAdmin = bootstrapAdminEmails.map((email) => email.toLowerCase()).includes(normalizedEmail);
  const userRef = doc(db, "users", user.uid);
  let userSnap = null;
  let existingRole = null;
  let role = bootstrapAdmin ? "admin" : "user";

  if (bootstrapAdmin) {
    applySignedInRole(user, role);
    showAuthMessage("Admin access granted from the local bootstrap admin list. Firestore profile sync is running in the background.");
    syncUserProfile(userRef, user, role, userSnap).catch((error) => {
      console.warn("Could not save bootstrap admin profile to Firestore.", error);
      showAuthMessage("Admin access is active locally, but Firestore rejected profile sync. Publish firestore.rules before importing or saving attendance.");
    });
    return;
  }

  try {
    userSnap = await withTimeout(getDoc(userRef), 8000, "Role lookup timed out.");
    existingRole = userSnap.exists() ? userSnap.data().role : null;
  } catch (error) {
    console.warn("Could not read user role from Firestore.", error);
    state.userRole = "user";
    els.authStatus.textContent = `${user.displayName || user.email} · signed in`;
    setAdminVisible(false);
    showAuthMessage("You are signed in, but Firestore rules are blocking role lookup. Publish firestore.rules, then refresh.");
    return;
  }

  role = existingRole || "user";

  try {
    await syncUserProfile(userRef, user, role, userSnap);
  } catch (error) {
    console.warn("Could not save user profile to Firestore.", error);
    showAuthMessage("You are signed in, but Firestore rejected the profile save. Publish firestore.rules and make sure your email is listed as a bootstrap admin.");
  }

  applySignedInRole(user, role);
}

async function syncUserProfile(userRef, user, role, userSnap) {
  await withTimeout(
    setDoc(
      userRef,
      {
        email: user.email,
        displayName: user.displayName || "",
        photoURL: user.photoURL || "",
        role,
        updatedAt: serverTimestamp(),
        createdAt: userSnap?.exists() ? userSnap.data().createdAt : serverTimestamp(),
      },
      { merge: true },
    ),
    8000,
    "Profile sync timed out.",
  );
}

function applySignedInRole(user, role) {
  state.userRole = role;
  els.authStatus.textContent = `${user.displayName || user.email} · ${role}`;
  els.loginBtn.classList.add("hidden");
  els.logoutBtn.classList.remove("hidden");
  setAdminVisible(role === "admin");

  if (role === "admin") {
    loadAdminData();
  }
}

async function loadAdminData() {
  await Promise.allSettled([
    withTimeout(loadEvents(), 8000, "Events load timed out."),
    withTimeout(loadRecentStudents(), 8000, "Student list load timed out."),
  ]);
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function shouldUseRedirectFallback(error) {
  return [
    "auth/popup-blocked",
    "auth/cancelled-popup-request",
    "auth/operation-not-supported-in-this-environment",
    "auth/web-storage-unsupported",
  ].includes(error.code);
}

function showAuthError(error) {
  console.error("Authentication error", error);
  const code = error?.code ? `${error.code}: ` : "";
  showAuthMessage(`${code}${error?.message || "Google sign-in failed."}`);
  showToast("Google sign-in needs attention.", "error");
}

function showAuthMessage(message) {
  els.authNotice.textContent = message;
  els.authNotice.classList.remove("hidden");
}

function hideAuthMessage() {
  els.authNotice.textContent = "";
  els.authNotice.classList.add("hidden");
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
  await loadPublicRecentEvents();
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
        <div class="list-row event-row">
          <span>
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(formatDate(item.eventDate))} · ${escapeHtml(item.createdByEmail || "Unknown creator")}</small>
          </span>
          <div class="row-actions">
            <button class="btn small" type="button" data-event-id="${escapeHtml(item.id)}">Select</button>
            <button class="btn danger small" type="button" data-delete-event="${escapeHtml(item.id)}">Delete</button>
          </div>
        </div>
      `,
    )
    .join("");

  els.eventsList.querySelectorAll("[data-event-id]").forEach((button) => {
    button.addEventListener("click", () => selectEvent(button.dataset.eventId));
  });

  els.eventsList.querySelectorAll("[data-delete-event]").forEach((button) => {
    button.addEventListener("click", () => deleteEventWithBackup(button.dataset.deleteEvent));
  });
}

async function deleteEventWithBackup(eventId) {
  if (!requireAdmin()) return;

  try {
    const eventSnap = await getDoc(doc(db, "events", eventId));
    if (!eventSnap.exists()) {
      showToast("Event was not found.", "error");
      await loadEvents();
      return;
    }

    const eventData = eventSnap.data();
    const attendance = await collectEventAttendance(eventId);
    const confirmed = window.confirm(
      `Delete "${eventData.title || "this event"}"?\n\nA backup JSON file with ${attendance.length} attendance record${attendance.length === 1 ? "" : "s"} will be downloaded first. This delete cannot be undone inside Firebase.`,
    );

    if (!confirmed) return;

    const backup = {
      app: "Attendance Checker",
      version: 1,
      type: "deleted-event-backup",
      exportedAt: new Date().toISOString(),
      counts: { attendance: attendance.length },
      data: {
        event: { id: eventId, data: serializeData(eventData) },
        attendance,
      },
    };

    downloadJson(backup, `deleted-event-${safeFileName(eventData.title || eventId)}-${dateStamp()}.json`);
    await Promise.all(attendance.map((row) => deleteDoc(doc(db, "events", eventId, "attendance", row.id))));
    await deleteDoc(doc(db, "events", eventId));

    if (state.activeEventId === eventId) {
      state.activeEventId = null;
      els.activeEventTitle.textContent = "Select an event";
      els.activeEventMeta.textContent = "Attendance tools appear here.";
      els.attendanceTools.classList.add("hidden");
      els.attendanceList.innerHTML = "";
      els.attendanceCount.textContent = "0";
    }

    showToast("Event deleted after backup download.");
    await Promise.allSettled([loadEvents(), loadPublicRecentEvents()]);
  } catch (error) {
    console.warn("Event delete failed.", error);
    showToast(`Event delete failed: ${error.message || "Try again."}`, "error");
  }
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
  await loadPublicRecentEvents();
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
      await loadPublicRecentEvents();
    });
  });
}

async function loadPublicRecentEvents() {
  if (!state.appReady) {
    renderPublicEventsError("Firebase is not configured yet.");
    return;
  }

  els.publicEventsList.innerHTML = `<p class="empty">Loading recent events...</p>`;
  const eventsQuery = query(collection(db, "events"), orderBy("eventDate", "desc"), limit(6));
  const snap = await getDocs(eventsQuery);
  const events = snap.docs.map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() }));

  if (!events.length) {
    els.publicEventsList.innerHTML = `<p class="empty">No events have been published yet.</p>`;
    return;
  }

  const eventCards = await Promise.all(
    events.map(async (item) => {
      const attendanceSnap = await getDocs(collection(db, "events", item.id, "attendance"));
      return {
        ...item,
        attendanceCount: attendanceSnap.size,
      };
    }),
  );

  els.publicEventsList.innerHTML = eventCards
    .map(
      (item) => `
        <article class="public-event-card">
          <div class="stat-row">
            <span>
              <strong>${escapeHtml(item.title)}</strong>
              <small>${escapeHtml(formatDate(item.eventDate))}</small>
            </span>
            <span class="big-count">${item.attendanceCount}</span>
          </div>
          ${item.description ? `<p class="event-description">${escapeHtml(item.description)}</p>` : ""}
          <button class="btn small" type="button" data-public-attendees="${escapeHtml(item.id)}">
            View attendees
          </button>
          <div class="public-attendees hidden" id="public-attendees-${escapeHtml(item.id)}"></div>
        </article>
      `,
    )
    .join("");

  els.publicEventsList.querySelectorAll("[data-public-attendees]").forEach((button) => {
    button.addEventListener("click", () => togglePublicAttendees(button.dataset.publicAttendees, button));
  });
}

async function togglePublicAttendees(eventId, button) {
  const container = document.querySelector(`#public-attendees-${CSS.escape(eventId)}`);
  if (!container) return;

  if (!container.classList.contains("hidden")) {
    container.classList.add("hidden");
    button.textContent = "View attendees";
    return;
  }

  button.textContent = "Hide attendees";
  container.classList.remove("hidden");
  container.innerHTML = `<p class="empty">Loading attendees...</p>`;

  try {
    const snap = await getDocs(collection(db, "events", eventId, "attendance"));
    const rows = snap.docs
      .map((attendanceDoc) => attendanceDoc.data())
      .sort((a, b) => String(a.indexNumber).localeCompare(String(b.indexNumber)));

    container.innerHTML = rows.length
      ? `<div class="compact-attendee-list">${rows
          .map(
            (row) => `
              <div class="attendee-pill">
                <strong>${escapeHtml(row.indexNumber)}</strong>
                <span>${escapeHtml(row.studentName || "Unknown")}</span>
              </div>
            `,
          )
          .join("")}</div>`
      : `<p class="empty">No attendees have been marked for this event yet.</p>`;
  } catch (error) {
    console.warn("Could not load public attendees.", error);
    container.innerHTML = `<p class="empty">Attendees could not be loaded.</p>`;
  }
}

function renderPublicEventsError(message) {
  els.publicEventsList.innerHTML = `<div class="notice warning">${escapeHtml(message)}</div>`;
}

async function downloadFullBackup() {
  if (!requireAdmin()) return;

  setBackupResult("Preparing full backup...");
  try {
    const [students, users, events] = await Promise.all([collectCollection("students"), collectCollection("users"), collectEventsWithAttendance()]);
    const backup = {
      app: "Attendance Checker",
      version: 1,
      type: "full",
      exportedAt: new Date().toISOString(),
      counts: {
        students: students.length,
        users: users.length,
        events: events.length,
        attendance: events.reduce((total, item) => total + item.attendance.length, 0),
      },
      data: { students, users, events },
    };

    downloadJson(backup, `attendance-checker-full-${dateStamp()}.json`);
    setBackupResult(`Full backup downloaded: ${backup.counts.students} students, ${backup.counts.events} events, ${backup.counts.attendance} attendance records.`);
  } catch (error) {
    console.warn("Full backup failed.", error);
    setBackupResult("Full backup failed. Make sure you are signed in as admin and Firestore rules are published.", "warning");
  }
}

async function downloadStudentsBackup() {
  if (!requireAdmin()) return;

  setBackupResult("Preparing students backup...");
  try {
    const students = await collectCollection("students");
    const backup = {
      app: "Attendance Checker",
      version: 1,
      type: "students",
      exportedAt: new Date().toISOString(),
      counts: { students: students.length },
      data: { students },
    };

    downloadJson(backup, `attendance-checker-students-${dateStamp()}.json`);
    setBackupResult(`Students backup downloaded: ${students.length} records.`);
  } catch (error) {
    console.warn("Students backup failed.", error);
    setBackupResult("Students backup failed. Make sure you are signed in as admin.", "warning");
  }
}

async function downloadActiveEventAttendance() {
  if (!requireAdmin() || !state.activeEventId) {
    showToast("Select an event first.", "error");
    return;
  }

  try {
    const eventSnap = await getDoc(doc(db, "events", state.activeEventId));
    const attendance = await collectEventAttendance(state.activeEventId);
    const eventData = eventSnap.exists() ? eventSnap.data() : {};
    const backup = {
      app: "Attendance Checker",
      version: 1,
      type: "event-attendance",
      exportedAt: new Date().toISOString(),
      counts: { attendance: attendance.length },
      data: {
        event: { id: state.activeEventId, data: eventData },
        attendance,
      },
    };

    downloadJson(backup, `attendance-${safeFileName(eventData.title || state.activeEventId)}-${dateStamp()}.json`);
    showToast(`Event attendance downloaded: ${attendance.length} records.`);
  } catch (error) {
    console.warn("Event attendance backup failed.", error);
    showToast("Event attendance backup failed.", "error");
  }
}

async function restoreFullBackup(event) {
  event.preventDefault();
  if (!requireAdmin()) return;

  const file = els.fullBackupFile.files[0];
  if (!file) {
    setBackupResult("Choose a full backup JSON file first.", "warning");
    return;
  }

  setBackupResult("Restoring full backup...");
  try {
    const backup = await readJsonFile(file);
    const students = normalizeBackupRows(backup?.data?.students || backup?.students, "indexNumber");
    const users = normalizeBackupRows(backup?.data?.users || backup?.users, "email");
    const events = Array.isArray(backup?.data?.events) ? backup.data.events : [];
    let attendanceCount = 0;

    await upsertUsers(users);
    await upsertStudents(students, false);
    for (const item of events) {
      const eventId = safeDocId(item.id) || crypto.randomUUID();
      const eventData = sanitizeEventBackupData(item.data || item);
      await setDoc(doc(db, "events", eventId), eventData, { merge: true });

      const attendance = normalizeBackupRows(item.attendance || [], "indexNumber");
      await upsertAttendance(eventId, attendance);
      attendanceCount += attendance.length;
    }

    els.restoreFullBackupForm.reset();
    await Promise.allSettled([loadEvents(), loadPublicRecentEvents(), loadRecentStudents()]);
    setBackupResult(`Full backup restored: ${students.length} students, ${users.length} users, ${events.length} events, ${attendanceCount} attendance records.`);
  } catch (error) {
    console.warn("Full restore failed.", error);
    setBackupResult(`Full restore failed: ${error.message || "Invalid backup file."}`, "warning");
  }
}

async function restoreStudentsBackup(event) {
  event.preventDefault();
  if (!requireAdmin()) return;

  const file = els.studentsBackupFile.files[0];
  if (!file) {
    setBackupResult("Choose a students backup JSON file first.", "warning");
    return;
  }

  setBackupResult("Restoring students backup...");
  try {
    const backup = await readJsonFile(file);
    const students = normalizeBackupRows(backup?.data?.students || backup?.students, "indexNumber");
    await upsertStudents(students, true);

    els.restoreStudentsBackupForm.reset();
    await loadRecentStudents();
    setBackupResult(`Students restored: ${students.length} records.`);
  } catch (error) {
    console.warn("Students restore failed.", error);
    setBackupResult(`Students restore failed: ${error.message || "Invalid backup file."}`, "warning");
  }
}

async function restoreActiveEventAttendance(event) {
  event.preventDefault();
  if (!requireAdmin() || !state.activeEventId) {
    showToast("Select an event first.", "error");
    return;
  }

  const file = els.eventAttendanceBackupFile.files[0];
  if (!file) {
    showToast("Choose an event attendance backup first.", "error");
    return;
  }

  try {
    const backup = await readJsonFile(file);
    const attendance = normalizeBackupRows(backup?.data?.attendance || backup?.attendance, "indexNumber");
    await upsertAttendance(state.activeEventId, attendance);

    els.restoreEventAttendanceForm.reset();
    await Promise.allSettled([loadAttendance(), loadPublicRecentEvents()]);
    showToast(`Attendance restored to selected event: ${attendance.length} records.`);
  } catch (error) {
    console.warn("Event attendance restore failed.", error);
    showToast(`Attendance restore failed: ${error.message || "Invalid backup file."}`, "error");
  }
}

async function collectCollection(collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  return snap.docs.map((item) => ({ id: item.id, data: serializeData(item.data()) }));
}

async function collectEventsWithAttendance() {
  const events = await collectCollection("events");
  return Promise.all(
    events.map(async (item) => ({
      ...item,
      attendance: await collectEventAttendance(item.id),
    })),
  );
}

async function collectEventAttendance(eventId) {
  const snap = await getDocs(collection(db, "events", eventId, "attendance"));
  return snap.docs
    .map((item) => ({ id: item.id, data: serializeData(item.data()) }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

async function upsertStudents(rows, requireRows) {
  if (!rows.length && requireRows) throw new Error("No student records found in the backup.");
  if (!rows.length) return;
  await Promise.all(
    rows.map((row) => {
      const student = sanitizeStudentBackupData(row.data || row);
      return setDoc(doc(db, "students", student.indexNumber), student, { merge: true });
    }),
  );
}

async function upsertUsers(rows) {
  if (!rows.length) return;
  await Promise.all(
    rows.map((row) => {
      const user = sanitizeUserBackupData(row.data || row);
      const userId = safeDocId(row.id) || safeDocId(user.email);
      if (!userId) throw new Error("A user record is missing a valid document ID.");
      return setDoc(doc(db, "users", userId), user, { merge: true });
    }),
  );
}

async function upsertAttendance(eventId, rows) {
  if (!rows.length) return;
  await Promise.all(
    rows.map((row) => {
      const attendance = sanitizeAttendanceBackupData(row.data || row);
      return setDoc(doc(db, "events", eventId, "attendance", attendance.indexNumber), attendance, { merge: true });
    }),
  );
}

function normalizeBackupRows(rows, idField) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const data = row?.data || row;
      const id = row?.id || data?.[idField];
      return id ? { id, data } : null;
    })
    .filter(Boolean);
}

function sanitizeStudentBackupData(data) {
  const indexNumber = normalizeIndex(data.indexNumber);
  const name = String(data.name || "").trim().replace(/\s+/g, " ").slice(0, 160);
  if (!indexNumber || !name) throw new Error("A student record is missing indexNumber or name.");

  return {
    indexNumber,
    name,
    batch: validBatch(data.batch),
    category: data.category === "custom" ? "custom" : "batch",
    updatedAt: data.updatedAt || serverTimestamp(),
    importedByUid: data.importedByUid || state.user.uid,
    importedByEmail: data.importedByEmail || state.user.email,
  };
}

function sanitizeUserBackupData(data) {
  const email = String(data.email || "").trim().toLowerCase().slice(0, 200);
  if (!email) throw new Error("A user record is missing an email address.");

  return {
    email,
    displayName: String(data.displayName || "").trim().slice(0, 120),
    photoURL: String(data.photoURL || "").trim().slice(0, 500),
    role: data.role === "admin" ? "admin" : "user",
    createdAt: data.createdAt || serverTimestamp(),
    updatedAt: data.updatedAt || serverTimestamp(),
  };
}

function sanitizeEventBackupData(data) {
  const title = String(data.title || "Restored event").trim().slice(0, 120) || "Restored event";
  const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(String(data.eventDate || "")) ? data.eventDate : new Date().toISOString().slice(0, 10);

  return {
    title,
    description: String(data.description || "").slice(0, 500),
    eventDate,
    createdAt: data.createdAt || serverTimestamp(),
    createdByUid: data.createdByUid || state.user.uid,
    createdByEmail: data.createdByEmail || state.user.email,
  };
}

function sanitizeAttendanceBackupData(data) {
  const indexNumber = normalizeIndex(data.indexNumber);
  const studentName = String(data.studentName || data.name || "").trim().replace(/\s+/g, " ").slice(0, 160);
  if (!indexNumber || !studentName) throw new Error("An attendance record is missing indexNumber or studentName.");

  return {
    indexNumber,
    studentName,
    batch: validBatch(data.batch),
    category: data.category === "custom" ? "custom" : "batch",
    markedAt: data.markedAt || serverTimestamp(),
    markedByUid: data.markedByUid || state.user.uid,
    markedByEmail: data.markedByEmail || state.user.email,
  };
}

function validBatch(value) {
  const batch = String(value || "").slice(0, 5);
  return [...REQUIRED_BATCHES, "other"].includes(batch) ? batch : "other";
}

function serializeData(data) {
  return JSON.parse(JSON.stringify(data));
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (error) {
        reject(new Error("The selected file is not valid JSON."));
      }
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsText(file);
  });
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function dateStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function safeFileName(value) {
  return String(value || "backup")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "backup";
}

function safeDocId(value) {
  const id = String(value || "").trim();
  return id && id.length <= 120 && !id.includes("/") ? id : "";
}

function setBackupResult(message, type = "success") {
  els.backupResults.innerHTML = `<div class="notice ${type}">${escapeHtml(message)}</div>`;
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
  try {
    const [studentSnap, eventsSnap] = await Promise.all([
      getDoc(doc(db, "students", indexNumber)),
      getDocs(query(collection(db, "events"), orderBy("eventDate", "desc"), limit(80))),
    ]);

    const eventChecks = await Promise.all(
      eventsSnap.docs.map(async (eventDoc) => {
        const attendanceSnap = await getDoc(doc(db, "events", eventDoc.id, "attendance", indexNumber));
        return attendanceSnap.exists()
          ? {
              id: eventDoc.id,
              attendance: attendanceSnap.data(),
              ...eventDoc.data(),
            }
          : null;
      }),
    );

    const eventRows = eventChecks
      .filter(Boolean)
      .sort((a, b) => String(b.eventDate).localeCompare(String(a.eventDate)));

    const student = studentSnap.exists() ? studentSnap.data() : eventRows[0]?.attendance || null;
    els.searchResults.innerHTML = `
      <section class="panel result-card">
        <div class="stat-row">
          <span>
            <strong>${escapeHtml(indexNumber)}</strong>
            <small>${escapeHtml(student?.name || student?.studentName || "No student record found")}</small>
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
  } catch (error) {
    console.warn("Attendance search failed.", error);
    els.searchResults.innerHTML = `
      <div class="notice warning">
        Search could not be completed. Check Firestore read rules and try again.
      </div>
    `;
  }
}

function normalizeIndex(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 32);
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
