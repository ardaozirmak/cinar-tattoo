// The panel at /admin: the login, the start, the five tabs and logging out. The tabs do their own
// work in photos.js, texts.js and settings.js; every call to the server goes through api.js.
//
// A session that ends (any 401 but the login's own) brings the login view back over the panel. The
// drafts stay, so whatever was typed is there again after the next login (Review Focus 5).
import { api, onUnauthorized } from './api.js';
import { closeDialogs, confirmDialog, hideToast, messageOf, toast } from './dom.js';
import { createDrafts } from './drafts.js';
import { setupPhotos } from './photos.js';
import { setupSettings } from './settings.js';
import { setupTextForms } from './texts.js';

const GUARD = 'Kaydedilmemiş değişiklikler var. Yine de çıkılsın mı?';
const LEAVE = 'Evet, çık';
const RESTORED = 'Kaydedilmemiş bir taslak geri getirildi.';
const SESSION_ENDED = 'Oturum kapandı. Tekrar giriş yap.';

const bootScreen = document.getElementById('boot');
const loginView = document.getElementById('login-view');
const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const loginButton = loginForm.querySelector('button[type="submit"]');
const app = document.getElementById('app');
const tabs = [...document.querySelectorAll('button[data-tab]')];
const panels = [...document.querySelectorAll('[data-panel]')];

const drafts = createDrafts();
const photos = setupPhotos();
const texts = setupTextForms({ drafts, onDirtyChange: markDirty });
const settings = setupSettings({ onLogout: logout });

let currentTab = 'photos';
let appShown = false;
const scrollOfTab = {};

onUnauthorized(() => showLogin(appShown ? SESSION_ENDED : ''));

// ---------------------------------------------------------------------------------------------
// Start and login
// ---------------------------------------------------------------------------------------------

// The owner wants the password on every visit: only a refresh of the same page keeps the session.
// Opening /admin anew (a new tab, the home-screen icon, a link, coming back from the site) ends
// whatever session this browser still had, and the login view comes up.
function isRefresh() {
  const entry = performance.getEntriesByType?.('navigation')?.[0];
  return entry?.type === 'reload';
}

async function endSessionAndAsk() {
  try {
    await api('logout', { method: 'POST' });
  } catch {
    // No connection: the login view still comes up, and the server ends the session by itself.
  }
  showLogin('');
}

async function start() {
  if (!isRefresh()) {
    await endSessionAndAsk();
    return;
  }
  try {
    await openApp();
  } catch (error) {
    // Without a session the 401 handler has already shown the login view. Anything else (a setup
    // problem, no connection) is said there too, word for word.
    if (error.status !== 401) showLogin(messageOf(error));
  }
}

// Loads everything the panel shows, builds the tabs, and puts back the drafts that differ from it.
async function openApp() {
  const state = await api('state');
  photos.render(state);
  settings.render(state);
  const restored = texts.render(state);
  showApp();
  if (restored > 0) toast(RESTORED);
  photos.loadStats();
}

function showApp() {
  bootScreen.hidden = true;
  loginView.hidden = true;
  app.hidden = false;
  appShown = true;
  selectTab(currentTab);
  window.scrollTo(0, scrollOfTab[currentTab] ?? 0);
  for (const tab of tabs) markDirty(tab.dataset.tab);
}

function showLogin(message) {
  if (appShown) scrollOfTab[currentTab] = window.scrollY;
  closeDialogs();
  hideToast();
  appShown = false;
  bootScreen.hidden = true;
  app.hidden = true;
  loginView.hidden = false;
  loginError.textContent = message;
  settings.clear();
  passwordInput.focus();
}

// The button stays disabled while a login is on its way: a second one would count as another
// attempt of the five the server allows.
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (loginButton.disabled) return;
  const password = passwordInput.value;
  if (password === '') {
    loginError.textContent = 'Şifreyi yaz.';
    passwordInput.focus();
    return;
  }
  loginButton.disabled = true;
  loginError.textContent = '';
  try {
    await api('login', { method: 'POST', json: { password } });
    passwordInput.value = '';
    await openApp();
  } catch (error) {
    loginError.textContent = messageOf(error);
  } finally {
    loginButton.disabled = false;
  }
});

async function logout() {
  if (texts.anyDirty() && !(await confirmDialog({ message: GUARD, confirm: LEAVE }))) return;
  try {
    await api('logout', { method: 'POST' });
    showLogin('');
  } catch (error) {
    toast(messageOf(error), { error: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------------------

for (const tab of tabs) tab.addEventListener('click', () => switchTab(tab.dataset.tab));

async function switchTab(name) {
  if (name === currentTab) return;
  if (texts.isDirty(currentTab) && !(await confirmDialog({ message: GUARD, confirm: LEAVE }))) return;
  scrollOfTab[currentTab] = window.scrollY;
  selectTab(name);
  window.scrollTo(0, scrollOfTab[name] ?? 0);
  document.getElementById(`title-${name}`)?.focus({ preventScroll: true });
}

function selectTab(name) {
  currentTab = name;
  for (const tab of tabs) {
    if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  for (const panel of panels) panel.hidden = panel.dataset.panel !== name;
}

// A dot on a tab that has a form with changes not saved yet.
function markDirty(name) {
  const tab = tabs.find((button) => button.dataset.tab === name);
  if (tab === undefined) return;
  const dirty = texts.isDirty(name);
  tab.toggleAttribute('data-dirty', dirty);
  tab.querySelector('[data-tab-dirty]')?.toggleAttribute('hidden', !dirty);
}

// Desktop browsers and Android can still warn before the page goes; iOS Safari cannot, which is
// what the drafts are for.
window.addEventListener('beforeunload', (event) => {
  if (!appShown || !texts.anyDirty()) return;
  event.preventDefault();
  event.returnValue = ''; // what older Chromium browsers (Samsung Internet among them) wait for
});

// Coming back with the browser's back button can show the page from memory without loading it.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) endSessionAndAsk();
});

start();
