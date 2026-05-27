const IMAGE_MANIFEST_PATH = "data/images.txt";
const DEFAULT_PAGE_TITLE = "Ministry of Memes and Better Propaganda";

const state = {
  supabase: null,
  currentImage: null,
  currentIndex: -1,
  images: [],
  totalCount: 0,
  skippedCount: 0,
  ratedCount: 0,
  ratedByPath: {},
  skippedPaths: new Set(),
  captchaToken: null,
  captchaWidgetId: null,
  starResizeObserver: null,
  score: null,
  hoverScore: null
};

const els = {
  imageTitle: document.querySelector("#image-title"),
  imageView: document.querySelector("#image-view"),
  previousButton: document.querySelector("#previous-button"),
  nextButton: document.querySelector("#next-button"),
  ratingForm: document.querySelector("#rating-form"),
  submitButton: document.querySelector("#submit-button"),
  formStatus: document.querySelector("#form-status"),
  scoreValue: document.querySelector("#score-value"),
  totalCount: document.querySelector("#total-count"),
  skippedCount: document.querySelector("#skipped-count"),
  ratedCount: document.querySelector("#rated-count"),
  starRating: document.querySelector("#star-rating"),
  connectionStatus: document.querySelector("#connection-status"),
  captchaSlot: document.querySelector("#captcha-slot")
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
    state.images = await loadImages();
    renderInitialImage();
    els.previousButton.disabled = false;
    els.nextButton.disabled = false;
  } catch (error) {
    setStatus(els.formStatus, `Could not load image manifest: ${error.message}`, "error");
  }

  setupSupabase();
}

function hasRequiredElements() {
  return Boolean(
    els.imageTitle &&
    els.imageView &&
    els.previousButton &&
    els.nextButton &&
    els.ratingForm &&
    els.submitButton &&
    els.formStatus &&
    els.scoreValue &&
    els.totalCount &&
    els.skippedCount &&
    els.ratedCount &&
    els.starRating &&
    els.connectionStatus &&
    els.captchaSlot
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

  els.ratingForm.addEventListener("submit", submitRating);
  window.addEventListener("hashchange", handleHashNavigation);
  window.addEventListener("resize", updateStarSizing);
  window.addEventListener("load", updateStarSizing);
  setupStarResizeObserver();
}

async function loadImages() {
  const response = await fetch(IMAGE_MANIFEST_PATH, { cache: "no-store" });
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
  state.totalCount = images.length;
  renderCounters();
  return shuffle(images);
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
  setStatus(
    els.connectionStatus,
    config.requireCaptchaForAuth
      ? "Supabase configured. Complete CAPTCHA when you are ready to save."
      : "Supabase configured. Ratings will sign in and save automatically.",
    "ok"
  );

  if (config.turnstileSiteKey) {
    waitForTurnstile(() => {
      state.captchaWidgetId = window.turnstile.render(els.captchaSlot, {
        sitekey: config.turnstileSiteKey,
        theme: "light",
        callback(token) {
          state.captchaToken = token;
          clearStatus(els.connectionStatus);
        },
        "expired-callback"() {
          state.captchaToken = null;
          setStatus(els.connectionStatus, "CAPTCHA expired. Please verify again.", "warn");
        }
      });
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
    return session;
  }

  if (config.requireCaptchaForAuth && !state.captchaToken) {
    throw new Error("Complete the CAPTCHA first so anonymous sign-in is harder to abuse.");
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

  setStatus(
    els.connectionStatus,
    "Protected session ready. Ratings will be saved to Supabase.",
    "ok"
  );

  return data.session;
}

function renderInitialImage() {
  if (!state.images.length) {
    els.imageTitle.textContent = "No images found";
    document.title = DEFAULT_PAGE_TITLE;
    return;
  }

  const hashIndex = getIndexFromHash();
  if (hashIndex !== -1) {
    state.currentIndex = hashIndex;
    renderCurrentImage();
    return;
  }

  state.currentIndex = Math.floor(Math.random() * state.images.length);
  renderCurrentImage();
}

function navigatePrevious() {
  if (!state.images.length) {
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

  const currentPath = state.currentImage.path;
  if (state.score === null && !state.ratedByPath[currentPath] && !state.skippedPaths.has(currentPath)) {
    state.skippedPaths.add(currentPath);
    state.skippedCount += 1;
    renderCounters();
  }

  state.currentIndex = state.currentIndex === -1
    ? 0
    : (state.currentIndex + 1 + state.images.length) % state.images.length;
  renderCurrentImage();
}

function renderCurrentImage() {
  if (!state.images.length || state.currentIndex < 0 || state.currentIndex >= state.images.length) {
    return;
  }

  state.currentImage = state.images[state.currentIndex];
  els.imageTitle.textContent = prettifyName(state.currentImage.name);
  els.imageView.src = encodeURI(state.currentImage.path);
  els.imageView.alt = state.currentImage.name;
  document.title = `${prettifyName(state.currentImage.name)} | ${DEFAULT_PAGE_TITLE}`;
  syncHashToCurrentImage();
  hydrateFormFromCurrentImage();
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
  if (!state.currentImage) {
    return;
  }

  const nextHash = `#${encodeURIComponent(state.currentImage.path)}`;
  if (window.location.hash === nextHash) {
    return;
  }

  window.history.replaceState(null, "", nextHash);
}

function handleHashNavigation() {
  const hashIndex = getIndexFromHash();
  if (hashIndex === -1 || hashIndex === state.currentIndex) {
    return;
  }

  state.currentIndex = hashIndex;
  renderCurrentImage();
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
  setStatus(els.formStatus, "Preparing protected save...", "muted");

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

    setStatus(els.formStatus, "Saving rating...", "muted");
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
    setStatus(els.formStatus, "Rating saved. Loading next image...", "ok");
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

function setStatus(element, message, tone) {
  element.textContent = message;
  element.className = `status-card status-${tone}`;
}

function clearStatus(element) {
  element.textContent = "";
  element.className = "status-card status-muted";
}

function renderCounters() {
  els.totalCount.textContent = String(state.totalCount);
  els.skippedCount.textContent = String(state.skippedCount);
  els.ratedCount.textContent = String(state.ratedCount);
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}
