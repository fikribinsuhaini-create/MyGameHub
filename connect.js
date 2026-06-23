const form = document.getElementById("connect-form");
const emailInput = document.getElementById("connect-email");
const statusNode = document.getElementById("connect-status");
const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
function showStatus(title, body, ok = true) {
  statusNode.classList.remove("hidden");
  statusNode.innerHTML = `<h3>${title}</h3><p class="muted">${body}</p>${ok ? '<a class="accent-button connect-link" href="./index.html">Open PuzzleHub</a>' : ''}`;
}
async function refreshSessionStatus() {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) {
    showStatus("Device connected", `Signed in as ${data.session.user.email}. You can return to PuzzleHub now.`);
    form.classList.add("hidden");
  }
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (!email) return;
  const redirectTo = `${location.origin}${location.pathname}`;
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
  if (error) {
    showStatus("Send failed", error.message, false);
    return;
  }
  showStatus("Magic link sent", `Check ${email}. Open link on this same device/browser to connect it.`, false);
});
supabase.auth.onAuthStateChange(async (_event, session) => {
  if (session?.user) {
    showStatus("Device connected", `Signed in as ${session.user.email}. Sync can run now.`);
    form.classList.add("hidden");
  }
});
refreshSessionStatus();
