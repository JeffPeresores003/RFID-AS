export const TEACHER_SESSION_KEY = "rfid_teacher_session";

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
