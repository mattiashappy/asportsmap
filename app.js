const API_URL = window.ASPORTMAP_API_URL || window.SPORTSMAP_API_URL || "/api/games";

const map = L.map("map", {
  zoomControl: false,
  maxBounds: [[-90, -180], [90, 180]],
  maxBoundsViscosity: 1.0
}).setView([25, 5], 2);
L.control.zoom({ position: "topright" }).addTo(map);
new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById("map"));
// Force Leaflet to recalculate after CSS layout has fully settled
requestAnimationFrame(() => requestAnimationFrame(() => map.invalidateSize()));
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
}).addTo(map);

const state = {
  games: [],
  filteredGames: [],
  markers: [],
  venueGames: [],
  venueGameIndex: -1
};

const elements = {
  search: document.getElementById("searchInput"),
  range: document.getElementById("dateRange"),
  rangeDays: document.getElementById("rangeDays"),
  fromDate: document.getElementById("fromDate"),
  toDate: document.getElementById("toDate"),
  card: document.getElementById("gameCard"),
  stadiumName: document.getElementById("stadiumName"),
  teamsCode: document.getElementById("teamsCode"),
  teamsFull: document.getElementById("teamsFull"),
  flag: document.getElementById("countryFlag"),
  competition: document.getElementById("competition"),
  gameTime: document.getElementById("gameTime"),
  prevGameBtn: document.getElementById("prevGameBtn"),
  nextGameBtn: document.getElementById("nextGameBtn"),
  affiliateBtn: document.getElementById("affiliateBtn"),
  sponsoredBadge: document.getElementById("sponsoredBadge"),
  closeCardBtn: document.getElementById("closeCardBtn")
};

function formatDate(dateLike) {
  return new Date(dateLike).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function normalizeGame(raw) {
  return {
    id: raw.id,
    sport: raw.sport || "football",
    competition: raw.competition || "Football",
    venue: raw.venue,
    city: raw.city,
    country: raw.country,
    capacity: raw.capacity,
    kickoff: raw.kickoff,
    lat: Number(raw.lat),
    lng: Number(raw.lng),
    homeTeam: raw.homeTeam,
    awayTeam: raw.awayTeam,
    flagUrl: raw.flagUrl || "",
    affiliateUrl: raw.affiliateUrl || "",
    affiliateLabel: raw.affiliateLabel || "",
    sponsored: !!raw.sponsored
  };
}

async function fetchGames() {
  const response = await fetch(API_URL);
  if (!response.ok) {
    throw new Error(`Failed to load games: ${response.status}`);
  }

  const payload = await response.json();
  return (payload.games || []).map(normalizeGame).filter((g) => g.sport === "football");
}

function withinDateRange(game, days) {
  const now = Date.now();
  const end = now + days * 24 * 60 * 60 * 1000;
  const kickoffMs = new Date(game.kickoff).getTime();
  return kickoffMs >= now && kickoffMs <= end;
}

function applyFilters() {
  const days = Number(elements.range.value);
  const q = elements.search.value.trim().toLowerCase();

  elements.rangeDays.textContent = String(days);

  const now = new Date();
  const to = new Date(Date.now() + days * 86400000);
  elements.fromDate.textContent = now.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  elements.toDate.textContent = to.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  state.filteredGames = state.games.filter((game) => {
    if (!withinDateRange(game, days)) return false;
    if (!q) return true;

    const haystack = `${game.venue} ${game.city} ${game.country} ${game.homeTeam} ${game.awayTeam}`.toLowerCase();
    return haystack.includes(q);
  });

  renderMarkers();
}

function clearMarkers() {
  state.markers.forEach((m) => m.remove());
  state.markers = [];
}

function sameVenue(left, right) {
  const leftVenue = String(left.venue || "").trim().toLowerCase();
  const rightVenue = String(right.venue || "").trim().toLowerCase();
  const sameVenueName = leftVenue && rightVenue && leftVenue === rightVenue;
  const sameCoordinates = Number.isFinite(left.lat) &&
    Number.isFinite(left.lng) &&
    Number.isFinite(right.lat) &&
    Number.isFinite(right.lng) &&
    Math.abs(left.lat - right.lat) < 0.0001 &&
    Math.abs(left.lng - right.lng) < 0.0001;

  return (
    sameVenueName || sameCoordinates
  );
}

function getVenueGames(game) {
  return state.games
    .filter((candidate) => sameVenue(candidate, game))
    .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
}

function updateNavArrows() {
  const many = state.venueGames.length > 1;
  elements.prevGameBtn.disabled = !many;
  elements.nextGameBtn.disabled = !many;
}

function showGame(game) {
  elements.card.classList.remove("hidden");
  state.venueGames = getVenueGames(game);
  state.venueGameIndex = state.venueGames.findIndex((venueGame) => venueGame.id === game.id);
  elements.stadiumName.textContent = game.venue;
  elements.teamsCode.textContent = `${game.homeTeam.slice(0, 3).toUpperCase()} × ${game.awayTeam.slice(0, 3).toUpperCase()}`;
  elements.teamsFull.textContent = `${game.homeTeam} vs ${game.awayTeam}`;
  elements.competition.textContent = game.competition;
  elements.gameTime.textContent = formatDate(game.kickoff);
  updateNavArrows();

  elements.sponsoredBadge.style.display = game.sponsored ? "inline-block" : "none";

  if (game.affiliateUrl) {
    elements.affiliateBtn.href = game.affiliateUrl;
    elements.affiliateBtn.textContent = game.affiliateLabel || "Buy tickets";
    elements.affiliateBtn.style.display = "inline-block";
  } else {
    elements.affiliateBtn.style.display = "none";
  }

  if (game.flagUrl) {
    elements.flag.src = game.flagUrl;
    elements.flag.style.visibility = "visible";
  } else {
    elements.flag.style.visibility = "hidden";
  }
}

function renderMarkers() {
  clearMarkers();

  const sorted = [...state.filteredGames].sort((a, b) => (a.sponsored ? 1 : 0) - (b.sponsored ? 1 : 0));
  sorted.forEach((game) => {
    const icon = game.sponsored
      ? L.divIcon({ className: "", html: '<div class="marker-star">⚽</div>' })
      : L.divIcon({ className: "marker-pin" });
    const marker = L.marker([game.lat, game.lng], { icon, zIndexOffset: game.sponsored ? 1000 : 0 }).addTo(map);
    marker.on("click", () => showGame(game));
    state.markers.push(marker);
  });

  // Only fit bounds when the user has typed a search query — otherwise
  // the map stays at its initial world view instead of zooming out to fit
  // all global markers on every render.
  const q = elements.search.value.trim();
  if (q && state.filteredGames.length) {
    const bounds = L.latLngBounds(state.filteredGames.map((g) => [g.lat, g.lng]));
    map.fitBounds(bounds.pad(0.45));
  }
}

function wireEvents() {
  elements.search.addEventListener("input", applyFilters);
  elements.range.addEventListener("input", applyFilters);
  elements.prevGameBtn.addEventListener("click", () => {
    if (state.venueGames.length < 2) return;
    const prevIndex = (state.venueGameIndex - 1 + state.venueGames.length) % state.venueGames.length;
    showGame(state.venueGames[prevIndex]);
  });
  elements.nextGameBtn.addEventListener("click", () => {
    if (state.venueGames.length < 2) return;
    const nextIndex = (state.venueGameIndex + 1) % state.venueGames.length;
    showGame(state.venueGames[nextIndex]);
  });
  elements.closeCardBtn.addEventListener("click", () => {
    elements.card.classList.add("hidden");
  });
}

async function boot() {
  wireEvents();

  try {
    state.games = await fetchGames();
    applyFilters();
    if (state.filteredGames.length) {
      showGame(state.filteredGames[0]);
    }
  } catch (error) {
    console.error(error);
    alert("Could not load game data. Kontrollera att Heroku Postgres är konfigurerad och att tabellen games innehåller data.");
  }
}

boot();
