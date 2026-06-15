let pin = '';

// Hash PIN without external dependency in login
function hashPin(p) {
  // Send raw PIN to main process for bcrypt comparison
  return p;
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
    
    // Send PIN directly - main process will hash and compare with bcrypt
    const ok = await window.api.verifyPin(pin);
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
