const API_URL = window.ASPORTMAP_API_URL || window.SPORTSMAP_API_URL || "/api/games";

const map = L.map("map", {
  zoomControl: false,
  maxBounds: [[-90, -180], [90, 180]],
  maxBoundsViscosity: 1.0
}).setView([25, 5], 2);
L.control.zoom({ position: "topright" }).addTo(map);
// Explicitly size the map container to fill exactly the space below the header.
// This is the most reliable approach across desktop and mobile browsers.
function fitMapToViewport() {
  const topbar = document.querySelector(".topbar");
  const main = document.getElementById("map").parentElement;
  const remaining = window.innerHeight - topbar.getBoundingClientRect().height;
  main.style.height = remaining + "px";
  map.invalidateSize();
}
fitMapToViewport();
window.addEventListener("resize", fitMapToViewport);
new ResizeObserver(fitMapToViewport).observe(document.querySelector(".topbar"));
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
}).addTo(map);

// ─── Translations ─────────────────────────────────────────────────────────────

const TRANSLATIONS = {
  en: {
    searchPlaceholder: "Search city, stadium, team...",
    nearMe: "Near me",
    nearMeTitle: "Find games near me",
    showGames: "Show games in the next",
    days: "days",
    sponsored: "★ Sponsored",
    buyTickets: "Buy tickets",
    closeLabel: "Close",
    prevGame: "Previous game",
    nextGame: "Next game",
    noLocation: "Geolocation is not supported by your browser.",
    locationError: "Could not get your location. Please check your browser permissions.",
    loadError: "Could not load game data. Please try again later."
  },
  sv: {
    searchPlaceholder: "Sök stad, arena, lag...",
    nearMe: "Nära mig",
    nearMeTitle: "Hitta matcher nära mig",
    showGames: "Visa matcher de nästa",
    days: "dagarna",
    sponsored: "★ Sponsrad",
    buyTickets: "Köp biljetter",
    closeLabel: "Stäng",
    prevGame: "Föregående match",
    nextGame: "Nästa match",
    noLocation: "Din webbläsare stöder inte platsinformation.",
    locationError: "Kunde inte hämta din plats. Kontrollera webbläsarens behörigheter.",
    loadError: "Kunde inte ladda matchdata. Försök igen senare."
  }
};

let currentLang = localStorage.getItem("lang") || "en";

function t(key) {
  return (TRANSLATIONS[currentLang] || TRANSLATIONS.en)[key] || key;
}

function applyLanguage() {
  document.documentElement.lang = currentLang;

  // Text content
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    // Don't overwrite affiliate button text when a custom label is set
    if (el.id === "affiliateBtn" && el.dataset.customLabel) return;
    el.textContent = t(key);
  });

  // Placeholders
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });

  // Title attributes
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });

  // Aria-labels
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });

  // Flag toggle: show the flag of the OTHER language (the one you'd switch to)
  const langToggle = document.getElementById("langToggle");
  if (langToggle) {
    if (currentLang === "en") {
      langToggle.innerHTML = '<img src="https://flagcdn.com/w40/se.png" alt="Svenska" class="lang-flag" />';
      langToggle.title = "Byt till svenska";
    } else {
      langToggle.innerHTML = '<img src="https://flagcdn.com/w40/us.png" alt="English" class="lang-flag" />';
      langToggle.title = "Switch to English";
    }
  }
}

// ─── State & elements ─────────────────────────────────────────────────────────

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
  const locale = currentLang === "sv" ? "sv-SE" : "en-GB";
  return new Date(dateLike).toLocaleString(locale, {
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
  const locale = currentLang === "sv" ? "sv-SE" : undefined;

  elements.rangeDays.textContent = String(days);

  const now = new Date();
  const to = new Date(Date.now() + days * 86400000);
  elements.fromDate.textContent = now.toLocaleDateString(locale, { month: "short", day: "numeric" });
  elements.toDate.textContent = to.toLocaleDateString(locale, { month: "short", day: "numeric" });

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
    // Use the game's custom label if set, otherwise fall back to translated default
    const label = game.affiliateLabel || t("buyTickets");
    elements.affiliateBtn.textContent = label;
    elements.affiliateBtn.dataset.customLabel = game.affiliateLabel ? "1" : "";
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

  // Language toggle
  document.getElementById("langToggle").addEventListener("click", () => {
    currentLang = currentLang === "en" ? "sv" : "en";
    localStorage.setItem("lang", currentLang);
    applyLanguage();
    applyFilters();
    const openGame = state.venueGames[state.venueGameIndex];
    if (openGame && !elements.card.classList.contains("hidden")) {
      showGame(openGame);
    }
  });

  const locateBtn = document.getElementById("locateBtn");
  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert(t("noLocation"));
      return;
    }
    locateBtn.classList.add("loading");
    locateBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locateBtn.classList.remove("loading");
        locateBtn.disabled = false;
        const { latitude, longitude } = pos.coords;
        map.setView([latitude, longitude], 8);
      },
      () => {
        locateBtn.classList.remove("loading");
        locateBtn.disabled = false;
        alert(t("locationError"));
      },
      { timeout: 10000 }
    );
  });

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
  applyLanguage();
  wireEvents();

  try {
    state.games = await fetchGames();
    applyFilters();
    if (state.filteredGames.length) {
      showGame(state.filteredGames[0]);
    }
  } catch (error) {
    console.error(error);
    alert(t("loadError"));
  }
}

boot();
