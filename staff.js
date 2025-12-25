import { collection, getDocs } from
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 🔒 Protect staff page
if (sessionStorage.getItem("staffLoggedIn") !== "true") {
  window.location.href = "index.html";
}

const searchInput = document.getElementById("searchInput");
const resultList = document.getElementById("resultList");
function logout() {
  sessionStorage.removeItem("staffLoggedIn");
  window.location.href = "index.html";
}

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) logoutBtn.onclick = logout;

const staffTitle = document.getElementById("staffTitle");
if (staffTitle) {
  staffTitle.style.cursor = "pointer";
  staffTitle.onclick = logout;
}


const drawingImg = document.getElementById("drawingImg");
const custTitle = document.getElementById("custTitle");
const custDetails = document.getElementById("custDetails");
const custDescription = document.getElementById("custDescription");

let records = [];

// Load all records once
async function loadRecords() {
  const snap = await getDocs(collection(db, "drawings"));
  records = snap.docs.map(doc => doc.data());
  console.log("Loaded records:", records);
}

function renderList(filter = "") {
  resultList.innerHTML = "";

  records
    .filter(r =>
      r.customerName?.toLowerCase().includes(filter.toLowerCase())
    )
    .forEach(r => {
      const div = document.createElement("div");
      div.textContent = r.customerName || "(No name)";
      div.className = "result-item";

      div.onclick = () => showRecord(r);
      resultList.appendChild(div);
    });
}

function showRecord(r) {
  custTitle.textContent = r.customerName || "Customer";
  drawingImg.src = r.image;

  custDetails.textContent =
    `Mobile: ${r.mobile}\n` +
    `Address: ${r.address}\n` +
    `Date: ${r.date}`;

  custDescription.textContent = r.description || "";

  document.getElementById("descriptionBlock").style.display = "block";
}

// Search input
searchInput.addEventListener("input", e => {
  renderList(e.target.value);
});

// Init
loadRecords().then(() => renderList());
