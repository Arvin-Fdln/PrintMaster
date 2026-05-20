let pin = '';

function hashPin(p) {
  // Simple hash for PIN (in production use bcrypt via main process)
  let h = 0;
  for (let i = 0; i < p.length; i++) { h = Math.imul(31, h) + p.charCodeAt(i) | 0; }
  return 'pm_' + Math.abs(h).toString(16).padStart(8,'0');
}

function updateDots() {
  for (let i = 0; i < 4; i++) {
    document.getElementById('d'+i).classList.toggle('filled', i < pin.length);
  }
}

function press(d) {
  if (pin.length >= 4) return;
  pin += d;
  updateDots();
  if (pin.length === 4) setTimeout(verify, 120);
}

function del() {
  pin = pin.slice(0,-1);
  updateDots();
  document.getElementById('err').textContent = '';
}

async function verify() {
  const ok = await window.api.verifyPin(hashPin(pin));
  if (ok) {
    await window.api.launchMain();
  } else {
    document.getElementById('err').textContent = 'Incorrect PIN. Try again.';
    document.getElementById('dots').classList.add('shake');
    setTimeout(() => { document.getElementById('dots').classList.remove('shake'); }, 400);
    pin = '';
    updateDots();
  }
}

document.addEventListener('keydown', e => {
  if (e.key >= '0' && e.key <= '9') press(e.key);
  else if (e.key === 'Backspace') del();
});
