let pin = '';

function hashPin(p) {
  let h = 0;
  for (let i = 0; i < p.length; i++) { h = Math.imul(31, h) + p.charCodeAt(i) | 0; }
  return 'pm_' + Math.abs(h).toString(16).padStart(8,'0');
}

function updateDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('d' + i);
    if (dot) dot.classList.toggle('filled', i < pin.length);
  }
}

window.press = function(d) {
  if (pin.length >= 4) return;
  pin += d;
  updateDots();
  if (pin.length === 4) {
    console.log("PIN complete, verifying...");
    setTimeout(verify, 100);
  }
};

window.del = function() {
  pin = pin.slice(0, -1);
  updateDots();
  document.getElementById('err').textContent = '';
};

async function verify() {
  try {
    if (!window.api || !window.api.verifyPin) {
      alert("Error: verifyPin is missing in preload.js!");
      return;
    }
    
    const ok = await window.api.verifyPin(hashPin(pin));
    if (ok) {
      await window.api.launchMain();
    } else {
      document.getElementById('err').textContent = 'Incorrect PIN.';
      pin = '';
      updateDots();
    }
  } catch (err) {
    alert("System Error: " + err.message);
  }
}

document.addEventListener('keydown', e => {
  if (e.key >= '0' && e.key <= '9') window.press(e.key);
  else if (e.key === 'Backspace') window.del();
});
