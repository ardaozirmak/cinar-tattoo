// The Ayarlar tab (spec §6.2): the picture of the shop sign, the password, the link to the site and
// logging out.
import { api } from './api.js';
import { messageOf, toast } from './dom.js';
import { uploadImage } from './upload.js';

/** The settings tab. `onLogout` runs for "Çıkış yap". Returns { render(state), clear() }. */
export function setupSettings({ onLogout }) {
  const preview = document.getElementById('hero-preview');
  const heroInput = document.getElementById('hero-input');
  const heroProgress = document.querySelector('[data-hero-progress]');
  const heroStatus = document.querySelector('[data-hero-status]');
  const heroBar = heroProgress.querySelector('progress');
  const heroError = document.querySelector('[data-hero-error]');

  // A picture that cannot be loaded says so instead of showing a broken image.
  const heroFrame = preview.closest('.hero-frame');
  preview.addEventListener('error', () => heroFrame.classList.add('is-broken'));
  preview.addEventListener('load', () => heroFrame.classList.remove('is-broken'));

  function showHero(hero) {
    preview.src = hero.thumb;
    preview.width = hero.width;
    preview.height = hero.height;
  }

  heroInput.addEventListener('change', async () => {
    const file = heroInput.files[0];
    heroInput.value = '';
    if (file === undefined) return;
    heroInput.disabled = true;
    heroError.textContent = '';
    try {
      const { hero } = await uploadImage('hero-image', file, { status: heroStatus, bar: heroBar, line: heroProgress });
      showHero(hero);
      toast('Fotoğraf değiştirildi');
    } catch (error) {
      heroError.textContent = messageOf(error);
    } finally {
      heroInput.disabled = false;
    }
  });

  // The password. Checks that need no server come first, so that a slip does not spend one of the
  // five attempts the server allows (it counts a wrong current password as a failed login). The
  // button stays disabled while a change is on its way: a second one would count twice.
  const passwordForm = document.getElementById('password-form');
  const current = document.getElementById('password-current');
  const next = document.getElementById('password-next');
  const repeat = document.getElementById('password-repeat');
  const passwordError = passwordForm.querySelector('[data-password-error]');
  const passwordButton = passwordForm.querySelector('button[type="submit"]');

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (passwordButton.disabled) return;
    passwordError.textContent = '';
    if (current.value === '') {
      passwordError.textContent = 'Mevcut şifreyi yaz.';
      return;
    }
    if (next.value !== repeat.value) {
      passwordError.textContent = 'Yeni şifreler aynı değil.';
      return;
    }
    passwordButton.disabled = true;
    try {
      await api('password', { method: 'POST', json: { current: current.value, next: next.value } });
      passwordForm.reset();
      toast('Şifre değiştirildi');
    } catch (error) {
      passwordError.textContent = messageOf(error);
    } finally {
      passwordButton.disabled = false;
    }
  });

  document.getElementById('logout-button').addEventListener('click', onLogout);

  return {
    render(state) {
      showHero(state.hero);
    },
    /** Empties the password fields and the messages: the panel is being left. */
    clear() {
      passwordForm.reset();
      passwordError.textContent = '';
      heroError.textContent = '';
    },
  };
}
