const RESULT_KEY = 'wensi:last-analysis';

export function saveResult(result) {
  try {
    sessionStorage.setItem(RESULT_KEY, JSON.stringify(result));
    return true;
  } catch {
    return false;
  }
}

export function loadResult() {
  try {
    const raw = sessionStorage.getItem(RESULT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
