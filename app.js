const IMAGE_MANIFESTS = {
  negative: "data/images.txt",
  positive: "data/images-positive.txt"
};
const README_CONTEXT_PATH = "readme.md";
const DEFAULT_PAGE_TITLE = "Memes";
const SITE_TITLE = "Ministry of Memes and Better Propaganda";
const RATING_MARKER = "<!-- MEMES TO BE RATED BELOW THIS LINE -->";
const FRAGMENT_BASE_PATH = "html-fragments/";
const INTRO_QUERY_KEY = "intro";
const MODE_QUERY_KEY = "mode";
const MIN_IMAGE_SPINNER_MS = 200;
const DEFAULT_MODE = "positive";
const RESUME_SESSION_KEY = "meme-rater-resume";

const state = {
  supabase: null,
  currentMode: DEFAULT_MODE,
  currentImage: null,
  currentIndex: -1,
  startIndex: -1,
  images: [],
  imagesByMode: {
    negative: [],
    positive: []
  },
  modeSessions: {
    negative: createModeSession(),
    positive: createModeSession()
  },
  contextByPath: {},
  totalCount: 0,
  skippedCount: 0,
  ratedCount: 0,
  ratedByPath: {},
  skippedPaths: new Set(),
  completionCelebrated: false,
  captchaToken: null,
  captchaWidgetId: null,
  starResizeObserver: null,
  imageRequestId: 0,
  imageCache: new Map(),
  score: null,
  hoverScore: null
};

const els = {
  introOverlay: document.querySelector("#intro-overlay"),
  introProceed: document.querySelector("#intro-proceed"),
  introVideo: document.querySelector("#intro-video"),
  introVideoBlur: document.querySelector("#intro-video-blur"),
  openIntroButton: document.querySelector("#open-intro-button"),
  confetti: document.querySelector("#completion-confetti"),
  modeToggle: document.querySelector("#mode-toggle"),
  modeLabelNegative: document.querySelector("#mode-label-negative"),
  modeLabelPositive: document.querySelector("#mode-label-positive"),
  imageTitle: document.querySelector("#image-title"),
  imageFrame: document.querySelector("#image-frame"),
  imageSpinner: document.querySelector("#image-spinner"),
  imageView: document.querySelector("#image-view"),
  previousButton: document.querySelector("#previous-button"),
  nextButton: document.querySelector("#next-button"),
  ratingForm: document.querySelector("#rating-form"),
  submitButton: document.querySelector("#submit-button"),
  formStatus: document.querySelector("#form-status"),
  completionStatus: document.querySelector("#completion-status"),
  scoreValue: document.querySelector("#score-value"),
  totalCount: document.querySelector("#total-count"),
  skippedCount: document.querySelector("#skipped-count"),
  ratedCount: document.querySelector("#rated-count"),
  imageContext: document.querySelector("#image-context"),
  starRating: document.querySelector("#star-rating"),
  connectionStatus: document.querySelector("#connection-status"),
  captchaSlot: document.querySelector("#captcha-slot"),
  modalOverlay: document.querySelector("#modal-overlay"),
  modalTitle: document.querySelector("#modal-title"),
  modalContent: document.querySelector("#modal-content"),
  modalClose: document.querySelector("#modal-close"),
  footerButtons: document.querySelectorAll("[data-fragment]")
};

boot();

async function boot() {
  if (!hasRequiredElements()) {
    console.error("Image Rater: required DOM elements are missing.");
    return;
  }

  wireEvents();
  els.submitButton.disabled = true;
  els.previousButton.disabled = true;
  els.nextButton.disabled = true;

  try {
    const [negativeImages, positiveImages] = await Promise.all([
      loadImagesForMode("negative"),
      loadImagesForMode("positive")
    ]);
    state.imagesByMode.negative = negativeImages;
    state.imagesByMode.positive = positiveImages;
    state.contextByPath = await loadContextByImagePath();
    state.currentMode = resolveInitialMode();
    restoreModeSession(state.currentMode);
    renderModeToggle();
    renderInitialImage();
    els.nextButton.disabled = false;
  } catch (error) {
    setStatus(els.formStatus, `Could not load image manifest: ${error.message}`, "error");
  }

  setupSupabase();
}

function hasRequiredElements() {
  return Boolean(
    els.imageTitle &&
    els.imageFrame &&
    els.imageSpinner &&
    els.imageView &&
    els.previousButton &&
    els.nextButton &&
    els.ratingForm &&
    els.submitButton &&
    els.formStatus &&
    els.completionStatus &&
    els.scoreValue &&
    els.totalCount &&
    els.skippedCount &&
    els.ratedCount &&
    els.imageContext &&
    els.starRating &&
    els.connectionStatus &&
    els.captchaSlot &&
    els.introOverlay &&
    els.introProceed &&
    els.introVideo &&
    els.introVideoBlur &&
    els.openIntroButton &&
    els.confetti &&
    els.modeToggle &&
    els.modeLabelNegative &&
    els.modeLabelPositive &&
    els.modalOverlay &&
    els.modalTitle &&
    els.modalContent &&
    els.modalClose
  );
}

function wireEvents() {
  buildStarRating();
  updateStarSizing();

  els.starRating.addEventListener("mousemove", (event) => {
    state.hoverScore = getScoreFromContainer(event.clientX);
    renderScoreState();
  });

  els.starRating.addEventListener("click", (event) => {
    setScore(getScoreFromContainer(event.clientX));
  });

  els.starRating.addEventListener("mouseleave", () => {
    state.hoverScore = null;
    renderScoreState();
  });

  els.previousButton.addEventListener("click", () => {
    navigatePrevious();
  });

  els.nextButton.addEventListener("click", () => {
    navigateNext();
  });
  els.modeToggle.addEventListener("click", toggleMode);

  els.ratingForm.addEventListener("submit", submitRating);
  els.introProceed.addEventListener("click", dismissIntro);
  els.introOverlay.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }

    if (event.target.closest(".intro-copy")) {
      return;
    }

    dismissIntro();
  });
  els.openIntroButton.addEventListener("click", showIntro);
  els.footerButtons.forEach((button) => {
    button.addEventListener("click", () => {
      openFragmentModal(button.dataset.fragment || "", button.textContent?.trim() || "");
    });
  });
  els.modalClose.addEventListener("click", closeFragmentModal);
  els.modalOverlay.addEventListener("click", (event) => {
    if (event.target === els.modalOverlay) {
      closeFragmentModal();
    }
  });
  window.addEventListener("hashchange", handleHashNavigation);
  window.addEventListener("popstate", handleLocationChange);
  window.addEventListener("beforeunload", persistResumeState);
  window.addEventListener("pagehide", persistResumeState);
  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", updateStarSizing);
  window.addEventListener("load", updateStarSizing);
  setupStarResizeObserver();
}

function dismissIntro({ updateHistory = true } = {}) {
  els.introOverlay.hidden = true;
  document.body.classList.remove("intro-open");
  if (updateHistory && isIntroRoute()) {
    setIntroRoute(false, "push");
    syncHashToCurrentImage();
  }
  updateDocumentTitle();
}

function showIntro({ updateHistory = true } = {}) {
  els.introOverlay.hidden = false;
  document.body.classList.add("intro-open");
  if (updateHistory && !isIntroRoute()) {
    setIntroRoute(true, "push");
  }
  resetAndPlayIntroVideos();
  updateDocumentTitle();
}

function resetAndPlayIntroVideos() {
  [els.introVideo, els.introVideoBlur].forEach((video) => {
    video.currentTime = 0;
    void video.play().catch(() => {});
  });
}

async function openFragmentModal(fragmentName, label) {
  if (!fragmentName) {
    return;
  }

  els.modalTitle.textContent = label || "Details";
  els.modalContent.innerHTML = "<p>Loading…</p>";
  els.modalOverlay.hidden = false;
  document.body.classList.add("modal-open");

  try {
    const response = await fetch(`${FRAGMENT_BASE_PATH}${fragmentName}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    els.modalContent.innerHTML = await response.text();
  } catch (error) {
    els.modalContent.innerHTML = `<p>Could not load this section: ${escapeHtml(error.message)}</p>`;
  }
}

function closeFragmentModal() {
  els.modalOverlay.hidden = true;
  els.modalContent.innerHTML = "";
  document.body.classList.remove("modal-open");
}

function handleKeydown(event) {
  if (event.key === "Escape" && !els.introOverlay.hidden) {
    dismissIntro();
    return;
  }

  if (event.key === "Escape" && !els.modalOverlay.hidden) {
    closeFragmentModal();
    return;
  }

  const target = event.target;
  const isTypingTarget = target instanceof HTMLElement && (
    target.tagName === "TEXTAREA" ||
    target.tagName === "INPUT" ||
    target.isContentEditable
  );

  if (isTypingTarget || !els.introOverlay.hidden || !els.modalOverlay.hidden) {
    return;
  }

  if (event.key === "ArrowLeft" && !els.previousButton.disabled) {
    event.preventDefault();
    navigatePrevious();
    return;
  }

  if ((event.key === "ArrowRight" || event.key === " ") && !els.nextButton.disabled) {
    event.preventDefault();
    navigateNext();
  }
}

async function loadImagesForMode(mode) {
  const response = await fetch(IMAGE_MANIFESTS[mode], { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  const images = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => ({
      path,
      folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "root",
      name: path.split("/").pop()
    }));
  return shuffle(images);
}

async function loadContextByImagePath() {
  try {
    const response = await fetch(README_CONTEXT_PATH, { cache: "no-store" });
    if (!response.ok) {
      return {};
    }

    return parseContextMap(await response.text());
  } catch (_error) {
    return {};
  }
}

function parseContextMap(markdown) {
  const contextByPath = {};
  const markerIndex = markdown.indexOf(RATING_MARKER);
  if (markerIndex === -1) {
    return contextByPath;
  }

  const lines = markdown.slice(markerIndex + RATING_MARKER.length).split("\n");
  let collectingContext = false;
  let pendingContextLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith("<!--")) {
      if (collectingContext) {
        pendingContextLines.push("");
      }
      continue;
    }

    const contextMatch = line.match(/^\*\*CONTEXT:\*\*\s*(.*)$/);
    if (contextMatch) {
      collectingContext = true;
      pendingContextLines = contextMatch[1] ? [contextMatch[1]] : [];
      continue;
    }

    const imagePath = extractImagePath(line);
    if (imagePath) {
      const normalizedContext = normalizeContextLines(pendingContextLines);
      if (normalizedContext) {
        contextByPath[imagePath] = normalizedContext;
      }
      collectingContext = false;
      pendingContextLines = [];
      continue;
    }

    if (collectingContext) {
      pendingContextLines.push(line);
    }
  }

  return contextByPath;
}

function extractImagePath(line) {
  const match = line.match(/!\[[^\]]*]\(([^)]+)\)/);
  return match ? decodeURIComponent(match[1].trim()) : null;
}

function normalizeContextLines(lines) {
  const normalized = lines.join("\n").trim();
  return normalized || "";
}

function setupSupabase() {
  const config = window.SUPABASE_CONFIG || {};
  const hasKeys = Boolean(config.supabaseUrl && config.supabaseAnonKey);

  if (!hasKeys || !window.supabase?.createClient) {
    setStatus(
      els.connectionStatus,
      "Supabase is not configured. Copy supabase-config.example.js to supabase-config.js and add your project values.",
      "warn"
    );
    return;
  }

  state.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  clearStatus(els.connectionStatus);
  updateCaptchaVisibility();

  if (config.turnstileSiteKey) {
    waitForTurnstile(() => {
      state.captchaWidgetId = window.turnstile.render(els.captchaSlot, {
        sitekey: config.turnstileSiteKey,
        theme: "light",
        callback(token) {
          state.captchaToken = token;
          clearStatus(els.connectionStatus);
          hideCaptcha();
        },
        "expired-callback"() {
          state.captchaToken = null;
          setStatus(els.connectionStatus, "CAPTCHA expired. Please verify again.", "warn");
          showCaptcha();
        }
      });
      updateCaptchaVisibility();
    });
  }
}

function waitForTurnstile(callback) {
  if (window.turnstile) {
    callback();
    return;
  }

  window.setTimeout(() => waitForTurnstile(callback), 150);
}

async function ensureAnonymousSession() {
  if (!state.supabase) {
    throw new Error("Add Supabase config before saving ratings.");
  }

  const config = window.SUPABASE_CONFIG || {};
  const {
    data: { session }
  } = await state.supabase.auth.getSession();

  if (session) {
    hideCaptcha();
    return session;
  }

  if (config.requireCaptchaForAuth && !state.captchaToken) {
    showCaptcha();
    throw new Error("Complete the CAPTCHA next to save, then tap save again.");
  }

  const options = state.captchaToken ? { captchaToken: state.captchaToken } : undefined;
  const { error, data } = await state.supabase.auth.signInAnonymously({ options });

  if (error) {
    throw error;
  }

  state.captchaToken = null;
  if (state.captchaWidgetId !== null && window.turnstile) {
    window.turnstile.reset(state.captchaWidgetId);
  }
  hideCaptcha();
  clearStatus(els.connectionStatus);

  return data.session;
}

function renderInitialImage() {
  state.images = state.imagesByMode[state.currentMode] || [];
  state.totalCount = state.images.length;
  renderCounters();

  if (!state.images.length) {
    els.imageTitle.textContent = "No images found";
    document.title = DEFAULT_PAGE_TITLE;
    return;
  }

  const resumedImagePath = consumeResumeImagePath();
  if (resumedImagePath) {
    const resumedIndex = state.images.findIndex((image) => image.path === resumedImagePath);
    if (resumedIndex !== -1) {
      dismissIntro({ updateHistory: false });
      state.images = rotateImagesToStartAt(resumedIndex);
      state.currentIndex = 0;
      state.startIndex = 0;
      state.totalCount = state.images.length;
      renderCounters();
      renderCurrentImage();
      return;
    }
  }

  const hashIndex = getIndexFromHash();
  if (hashIndex !== -1) {
    dismissIntro({ updateHistory: false });
    state.images = rotateImagesToStartAt(hashIndex);
    state.currentIndex = 0;
    state.startIndex = 0;
    state.totalCount = state.images.length;
    renderCounters();
    renderCurrentImage();
    return;
  }

  state.currentIndex = 0;
  state.startIndex = 0;
  renderCurrentImage();
  if (shouldShowIntroForCurrentMode()) {
    if (!isIntroRoute()) {
      setIntroRoute(true, "replace");
    }
    showIntro({ updateHistory: false });
  } else {
    if (isIntroRoute()) {
      setIntroRoute(false, "replace");
    }
    dismissIntro({ updateHistory: false });
  }
}

function navigatePrevious() {
  if (!state.images.length) {
    return;
  }

  if (state.currentIndex === state.startIndex) {
    renderCurrentImage();
    return;
  }

  state.currentIndex = state.currentIndex <= 0
    ? state.images.length - 1
    : state.currentIndex - 1;
  renderCurrentImage();
}

function navigateNext() {
  if (!state.images.length || !state.currentImage) {
    return;
  }

  countCurrentImageAsSkippedIfNeeded();

  if (state.currentIndex >= state.images.length - 1) {
    celebrateCompletion();
    return;
  }

  state.currentIndex = state.currentIndex === -1
    ? 0
    : Math.min(state.currentIndex + 1, state.images.length - 1);
  renderCurrentImage();
}

async function renderCurrentImage() {
  if (!state.images.length || state.currentIndex < 0 || state.currentIndex >= state.images.length) {
    return;
  }

  const requestId = state.imageRequestId + 1;
  state.imageRequestId = requestId;
  state.currentImage = state.images[state.currentIndex];
  const displayTitle = `${getSequencePosition()}. ${prettifyName(state.currentImage.name)}`;
  els.imageTitle.textContent = displayTitle;
  els.previousButton.disabled = state.currentIndex === state.startIndex;
  els.nextButton.disabled = state.currentIndex >= state.images.length - 1 && state.completionCelebrated;
  updateDocumentTitle();
  renderCurrentContext();
  renderCompletionStatus();
  syncHashToCurrentImage();
  hydrateFormFromCurrentImage();

  setImageLoading(true);
  const currentPath = state.currentImage.path;

  try {
    await Promise.all([
      loadImageAsset(currentPath),
      delay(MIN_IMAGE_SPINNER_MS)
    ]);
  } catch (_error) {
    // Let the browser still attempt to render the image URL below.
  }

  if (requestId !== state.imageRequestId) {
    return;
  }

  els.imageView.src = encodeURI(currentPath);
  els.imageView.alt = state.currentImage.name;
  setImageLoading(false);
  preloadAdjacentImage(1);
}

function updateDocumentTitle() {
  if (!state.currentImage || !els.introOverlay.hidden) {
    document.title = DEFAULT_PAGE_TITLE;
    return;
  }

  document.title = `Memes | ${prettifyName(state.currentImage.name)} | ${SITE_TITLE}`;
}

function getSequencePosition() {
  if (!state.images.length || state.currentIndex < 0 || state.startIndex < 0) {
    return 1;
  }

  return state.currentIndex + 1;
}

function renderCurrentContext() {
  const context = state.currentImage ? state.contextByPath[state.currentImage.path] : "";
  if (!context) {
    els.imageContext.innerHTML = "";
    els.imageContext.hidden = true;
    return;
  }

  els.imageContext.innerHTML = `
    <p class="context-label">CONTEXT:</p>
    ${renderContextHtml(context)}
  `;
  els.imageContext.hidden = false;
}

function getIndexFromHash() {
  const rawHash = window.location.hash.slice(1);
  if (!rawHash) {
    return -1;
  }

  const decodedPath = decodeURIComponent(rawHash);
  return state.images.findIndex((image) => image.path === decodedPath);
}

function syncHashToCurrentImage() {
  if (!state.currentImage || !els.introOverlay.hidden) {
    return;
  }

  const nextHash = `#${encodeURIComponent(state.currentImage.path)}`;
  const url = new URL(window.location.href);
  if (state.currentMode === DEFAULT_MODE) {
    url.searchParams.delete(MODE_QUERY_KEY);
  } else {
    url.searchParams.set(MODE_QUERY_KEY, state.currentMode);
  }

  if (url.hash === nextHash && getModeFromUrl() === state.currentMode) {
    return;
  }

  url.hash = nextHash;
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function preloadAdjacentImage(offset) {
  if (!state.images.length || state.currentIndex < 0) {
    return;
  }

  const nextIndex = (state.currentIndex + offset + state.images.length) % state.images.length;
  const nextImage = state.images[nextIndex];
  if (nextImage) {
    void loadImageAsset(nextImage.path);
  }
}

function loadImageAsset(path) {
  if (state.imageCache.has(path)) {
    return state.imageCache.get(path);
  }

  const imagePromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(path);
    img.onerror = () => reject(new Error(`Could not preload ${path}`));
    img.src = encodeURI(path);
  });

  state.imageCache.set(path, imagePromise);
  return imagePromise;
}

function setImageLoading(isLoading) {
  els.imageFrame.classList.toggle("is-loading", isLoading);
  els.imageSpinner.hidden = !isLoading;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function handleHashNavigation() {
  const hashIndex = getIndexFromHash();
  if (hashIndex === -1 || hashIndex === state.currentIndex) {
    return;
  }

  state.currentIndex = hashIndex;
  renderCurrentImage();
}

function handleLocationChange() {
  const urlMode = getModeFromUrl();
  if (urlMode !== state.currentMode) {
    switchMode(urlMode, { updateHistory: false });
  }

  if (isIntroRoute() && shouldShowIntroForCurrentMode()) {
    showIntro({ updateHistory: false });
  } else {
    dismissIntro({ updateHistory: false });
  }

  const hashIndex = getIndexFromHash();
  if (hashIndex !== -1 && hashIndex !== state.currentIndex) {
    state.currentIndex = hashIndex;
    renderCurrentImage();
  }
}

function isIntroRoute() {
  const search = new URLSearchParams(window.location.search);
  return search.get(INTRO_QUERY_KEY) === "1";
}

function rotateImagesToStartAt(index) {
  if (index <= 0 || index >= state.images.length) {
    return state.images;
  }

  return [...state.images.slice(index), ...state.images.slice(0, index)];
}

function persistResumeState() {
  const resumePath = getVisibleImagePath() || state.currentImage?.path || "";
  if (!resumePath) {
    window.sessionStorage.removeItem(RESUME_SESSION_KEY);
    return;
  }

  window.sessionStorage.setItem(
    RESUME_SESSION_KEY,
    JSON.stringify({
      mode: state.currentMode,
      path: resumePath
    })
  );
}

function consumeResumeImagePath() {
  const raw = window.sessionStorage.getItem(RESUME_SESSION_KEY);
  if (!raw) {
    return "";
  }

  window.sessionStorage.removeItem(RESUME_SESSION_KEY);

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.mode !== state.currentMode) {
      return "";
    }
    return typeof parsed.path === "string" ? parsed.path : "";
  } catch (_error) {
    return "";
  }
}

function getVisibleImagePath() {
  const visiblePath = els.imageView?.getAttribute("src");
  return visiblePath ? decodeURIComponent(visiblePath) : "";
}

function setIntroRoute(active, historyMode) {
  const url = new URL(window.location.href);
  if (active) {
    url.searchParams.set(INTRO_QUERY_KEY, "1");
    url.hash = "";
  } else {
    url.searchParams.delete(INTRO_QUERY_KEY);
  }

  if (state.currentMode === DEFAULT_MODE) {
    url.searchParams.delete(MODE_QUERY_KEY);
  } else {
    url.searchParams.set(MODE_QUERY_KEY, state.currentMode);
  }

  window.history[historyMode === "replace" ? "replaceState" : "pushState"](null, "", `${url.pathname}${url.search}${url.hash}`);
}

async function submitRating(event) {
  event.preventDefault();

  if (!state.supabase || !state.currentImage) {
    setStatus(els.formStatus, "Add Supabase config before submitting ratings.", "warn");
    return;
  }

  if (state.score === null) {
    setStatus(els.formStatus, "Choose a score before saving.", "warn");
    return;
  }

  const formData = new FormData(els.ratingForm);
  els.submitButton.disabled = true;
  clearStatus(els.formStatus);

  try {
    await ensureAnonymousSession();
    const {
      data: { user },
      error: authError
    } = await state.supabase.auth.getUser();

    if (authError || !user) {
      throw new Error("Could not resolve the active user session.");
    }

    const payload = {
      user_id: user.id,
      image_path: state.currentImage.path,
      image_folder: state.currentImage.folder,
      image_name: state.currentImage.name,
      score: state.score,
      negative_feedback: String(formData.get("negative") || "").trim(),
      neutral_feedback: String(formData.get("neutral") || "").trim(),
      positive_feedback: String(formData.get("positive") || "").trim()
    };

    const { error } = await state.supabase
      .from((window.SUPABASE_CONFIG || {}).ratingsTable || "image_ratings")
      .upsert(payload, { onConflict: "user_id,image_path" });

    if (error) {
      throw error;
    }

    const currentPath = state.currentImage.path;
    const existingEntry = state.ratedByPath[currentPath];
    if (!existingEntry) {
      state.ratedCount += 1;
    }

    state.ratedByPath[currentPath] = {
      score: state.score,
      positive: payload.positive_feedback,
      neutral: payload.neutral_feedback,
      negative: payload.negative_feedback
    };
    renderCounters();
    clearStatus(els.formStatus);
    navigateNext();
  } catch (error) {
    setStatus(els.formStatus, `Save failed: ${error.message}`, "error");
  } finally {
    els.submitButton.disabled = false;
  }
}

function clearForm() {
  els.ratingForm.reset();
  setScore(null);
}

function hydrateFormFromCurrentImage() {
  const entry = state.currentImage ? state.ratedByPath[state.currentImage.path] : null;
  if (!entry) {
    clearForm();
    return;
  }

  document.querySelector("#positive").value = entry.positive || "";
  document.querySelector("#neutral").value = entry.neutral || "";
  document.querySelector("#negative").value = entry.negative || "";
  setScore(entry.score ?? null);
}

function buildStarRating() {
  const fragment = document.createDocumentFragment();

  for (let whole = 1; whole <= 10; whole += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "star-button";
    button.dataset.whole = String(whole);
    button.setAttribute("aria-label", `${whole} star rating`);
    button.setAttribute("role", "radio");
    fragment.appendChild(button);
  }

  els.starRating.appendChild(fragment);
  renderScoreState();
}

function setupStarResizeObserver() {
  if (!("ResizeObserver" in window)) {
    return;
  }

  state.starResizeObserver?.disconnect();
  state.starResizeObserver = new window.ResizeObserver(() => {
    updateStarSizing();
  });
  state.starResizeObserver.observe(els.starRating);
}

function updateStarSizing() {
  const buttons = els.starRating.querySelectorAll(".star-button");
  if (!buttons.length) {
    return;
  }

  const styles = window.getComputedStyle(els.starRating);
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
  const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
  const availableWidth = els.starRating.clientWidth - paddingLeft - paddingRight;
  const starSize = Math.max(18, Math.min(44, Math.floor((availableWidth - gap * 9) / 10)));
  els.starRating.style.setProperty("--star-size", `${starSize}px`);
}

function setScore(value) {
  state.score = value === null ? null : Number(value.toFixed(1));
  state.hoverScore = null;
  renderScoreState();
}

function renderScoreState() {
  const displayScore = state.hoverScore ?? state.score;
  els.scoreValue.textContent = displayScore === null ? "..." : displayScore.toFixed(1);
  els.submitButton.disabled = state.score === null;

  const buttons = els.starRating.querySelectorAll(".star-button");
  buttons.forEach((button) => {
    const whole = Number(button.dataset.whole);
    let fill = 0;

    if (displayScore !== null && displayScore >= whole) {
      fill = 1;
    } else if (displayScore !== null && displayScore === whole - 0.5) {
      fill = 0.5;
    }

    button.style.setProperty("--fill", String(fill));
    button.classList.toggle("is-active", fill > 0);
    button.classList.toggle("is-preview", state.hoverScore !== null);
    button.setAttribute(
      "aria-checked",
      state.score !== null && (state.score === whole || state.score === whole - 0.5) ? "true" : "false"
    );
  });
}

function getScoreFromContainer(pointerX) {
  const buttons = els.starRating.querySelectorAll(".star-button");
  if (!buttons.length) {
    return state.score;
  }

  const firstRect = buttons[0].getBoundingClientRect();
  const lastRect = buttons[buttons.length - 1].getBoundingClientRect();
  const leftEdge = firstRect.left;
  const rightEdge = lastRect.right;
  const width = Math.max(rightEdge - leftEdge, 1);
  const relativeX = Math.min(Math.max(pointerX - leftEdge, 0), width);
  if (relativeX <= width * 0.025) {
    return 0;
  }
  const adjustedX = relativeX - width * 0.025;
  const adjustedWidth = width * 0.975;
  const halfSteps = Math.max(1, Math.min(20, Math.round((adjustedX / adjustedWidth) * 19) + 1));
  return halfSteps / 2;
}

function prettifyName(name) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/\s-[A-Za-z]$/, "")
    .replace(/[-_]+/g, " ");
}

function renderContextHtml(context) {
  const lines = context.split("\n");
  const blocks = [];
  let paragraphLines = [];
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) {
      return;
    }
    blocks.push(`<p>${renderInlineContext(paragraphLines.join(" "))}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listItems.length) {
      return;
    }
    blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineContext(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      listItems.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }

    if (listItems.length) {
      flushList();
    }
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return blocks.join("");
}

function renderInlineContext(text) {
  const escaped = escapeHtml(text);
  const withMarkdownLinks = escaped.replace(
    /\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
  );

  return withMarkdownLinks.replace(
    /(^|[\s(>])((https?:\/\/[^\s<]+))/g,
    (_match, prefix, url) => `${prefix}<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`
  );
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(element, message, tone) {
  element.textContent = message;
  element.className = `status-card status-${tone}`;
}

function clearStatus(element) {
  element.textContent = "";
  element.className = "status-card status-muted";
}

function requiresCaptcha() {
  const config = window.SUPABASE_CONFIG || {};
  return Boolean(config.requireCaptchaForAuth && config.turnstileSiteKey);
}

function updateCaptchaVisibility() {
  if (!requiresCaptcha()) {
    hideCaptcha();
    return;
  }

  if (state.captchaToken) {
    hideCaptcha();
    return;
  }

  showCaptcha();
}

function showCaptcha() {
  els.captchaSlot.classList.add("is-visible");
}

function hideCaptcha() {
  els.captchaSlot.classList.remove("is-visible");
}

function renderCounters() {
  els.totalCount.textContent = String(state.totalCount);
  els.skippedCount.textContent = String(state.skippedCount);
  els.ratedCount.textContent = String(state.ratedCount);
}

function createModeSession() {
  return {
    currentImage: null,
    currentIndex: -1,
    startIndex: -1,
    skippedCount: 0,
    ratedCount: 0,
    ratedByPath: {},
    skippedPaths: new Set(),
    completionCelebrated: false
  };
}

function saveCurrentModeSession() {
  state.modeSessions[state.currentMode] = {
    currentImage: state.currentImage,
    currentIndex: state.currentIndex,
    startIndex: state.startIndex,
    skippedCount: state.skippedCount,
    ratedCount: state.ratedCount,
    ratedByPath: { ...state.ratedByPath },
    skippedPaths: new Set(state.skippedPaths),
    completionCelebrated: state.completionCelebrated
  };
}

function restoreModeSession(mode) {
  const session = state.modeSessions[mode] || createModeSession();
  state.images = state.imagesByMode[mode] || [];
  state.totalCount = state.images.length;
  state.currentImage = session.currentImage;
  state.currentIndex = session.currentIndex;
  state.startIndex = session.startIndex;
  state.skippedCount = session.skippedCount;
  state.ratedCount = session.ratedCount;
  state.ratedByPath = { ...session.ratedByPath };
  state.skippedPaths = new Set(session.skippedPaths);
  state.completionCelebrated = Boolean(session.completionCelebrated);
  renderCounters();
}

function resolveInitialMode() {
  const urlMode = getModeFromUrl();
  if (urlMode !== DEFAULT_MODE) {
    return urlMode;
  }

  const rawHash = window.location.hash.slice(1);
  if (!rawHash) {
    return DEFAULT_MODE;
  }

  const decodedPath = decodeURIComponent(rawHash);
  if (state.imagesByMode.positive.some((image) => image.path === decodedPath)) {
    return "positive";
  }
  if (state.imagesByMode.negative.some((image) => image.path === decodedPath)) {
    return "negative";
  }

  return DEFAULT_MODE;
}

function getModeFromUrl() {
  const search = new URLSearchParams(window.location.search);
  const mode = search.get(MODE_QUERY_KEY);
  return mode === "negative" || mode === "positive" ? mode : DEFAULT_MODE;
}

function toggleMode() {
  switchMode(state.currentMode === "positive" ? "negative" : "positive");
}

function switchMode(mode, { updateHistory = true } = {}) {
  if (mode === state.currentMode) {
    return;
  }

  saveCurrentModeSession();
  state.currentMode = mode;
  restoreModeSession(mode);
  renderModeToggle();

  const hashIndex = getIndexFromHash();
  if (hashIndex !== -1) {
    state.currentIndex = hashIndex;
    if (state.startIndex === -1) {
      state.startIndex = hashIndex;
    }
    renderCurrentImage();
  } else if (state.currentIndex >= 0 && state.currentIndex < state.images.length) {
    renderCurrentImage();
  } else {
    renderInitialImage();
  }

  if (updateHistory) {
    syncHashToCurrentImage();
  }

  renderCompletionStatus();
}

function shouldShowIntroForCurrentMode() {
  return state.currentMode === DEFAULT_MODE;
}

function renderModeToggle() {
  const isPositive = state.currentMode === "positive";
  els.modeToggle.classList.toggle("is-positive", isPositive);
  els.modeToggle.classList.toggle("is-negative", !isPositive);
  els.modeToggle.setAttribute("aria-checked", String(isPositive));
  els.modeLabelPositive.classList.toggle("is-active", isPositive);
  els.modeLabelNegative.classList.toggle("is-active", !isPositive);
}

function celebrateCompletion() {
  if (state.completionCelebrated) {
    return;
  }

  state.completionCelebrated = true;
  saveCurrentModeSession();
  launchConfetti();
  renderCurrentImage();
}

function launchConfetti() {
  const colors = ["#f6bd18", "#154734", "#d46842", "#fff4cf", "#b24a2a"];
  els.confetti.innerHTML = "";

  for (let index = 0; index < 28; index += 1) {
    const piece = document.createElement("span");
    piece.className = "completion-confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[index % colors.length];
    piece.style.setProperty("--drift", `${(Math.random() - 0.5) * 180}px`);
    piece.style.setProperty("--spin", `${(Math.random() - 0.5) * 960}deg`);
    piece.style.animationDelay = `${Math.random() * 120}ms`;
    els.confetti.appendChild(piece);
  }

  window.setTimeout(() => {
    els.confetti.innerHTML = "";
  }, 1800);
}

function countCurrentImageAsSkippedIfNeeded() {
  const currentPath = state.currentImage?.path;
  if (!currentPath) {
    return;
  }

  if (state.score === null && !state.ratedByPath[currentPath] && !state.skippedPaths.has(currentPath)) {
    state.skippedPaths.add(currentPath);
    state.skippedCount += 1;
    renderCounters();
  }
}

function renderCompletionStatus() {
  if (!state.completionCelebrated) {
    clearStatus(els.completionStatus);
    return;
  }

  const otherMode = state.currentMode === "positive" ? "negative" : "positive";
  const otherModeCompleted = Boolean(state.modeSessions[otherMode]?.completionCelebrated);

  if (otherModeCompleted) {
    setStatus(
      els.completionStatus,
      "You are a legend, very few completed that, join our social media circus.",
      "ok"
    );
    return;
  }

  const nextModeLabel = otherMode === "positive" ? "positive" : "doom";
  setHtmlStatus(
    els.completionStatus,
    `You have seen all the memes, <button type="button" class="inline-status-button" data-switch-mode="${otherMode}">click here to switch to ${nextModeLabel}</button>.`,
    "ok"
  );
  els.completionStatus.querySelector("[data-switch-mode]")?.addEventListener("click", () => {
    switchMode(otherMode);
  });
}

function setHtmlStatus(element, html, tone) {
  element.innerHTML = html;
  element.className = `status-card status-${tone}`;
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}
