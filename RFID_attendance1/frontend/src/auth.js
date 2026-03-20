export const TEACHER_SESSION_KEY = "rfid_teacher_session";
export const ADMIN_SESSION_KEY = "rfid_admin_session";

export function getTeacherSession() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(TEACHER_SESSION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.teachers_id || !parsed.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setTeacherSession(teacher) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TEACHER_SESSION_KEY, JSON.stringify(teacher));
}

export function clearTeacherSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TEACHER_SESSION_KEY);
}

export function getAdminSession() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.token || !parsed.admin?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setAdminSession(session) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
}

export function clearAdminSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ADMIN_SESSION_KEY);
}
