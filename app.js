const IMAGE_MANIFEST_PATH = "data/images.txt";
const SESSION_STORAGE_KEY = "planetary-council-rater";

const state = {
  supabase: null,
  currentImage: null,
  currentIndex: -1,
  images: [],
  ratedImages: loadLocalSession(),
  captchaToken: null,
  captchaWidgetId: null,
  score: 5,
  hoverScore: null
};

const els = {
  imageTitle: document.querySelector("#image-title"),
  imageView: document.querySelector("#image-view"),
  imageFolder: document.querySelector("#image-folder"),
  imageLink: document.querySelector("#image-link"),
  previousButton: document.querySelector("#previous-button"),
  nextButton: document.querySelector("#next-button"),
  ratingForm: document.querySelector("#rating-form"),
  submitButton: document.querySelector("#submit-button"),
  formStatus: document.querySelector("#form-status"),
  scoreValue: document.querySelector("#score-value"),
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
  els.previousButton.disabled = true;
  els.nextButton.disabled = true;

  try {
    state.images = await loadImages();
    renderRandomImage();
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
    els.imageFolder &&
    els.imageLink &&
    els.previousButton &&
    els.nextButton &&
    els.ratingForm &&
    els.submitButton &&
    els.formStatus &&
    els.scoreValue &&
    els.starRating &&
    els.connectionStatus &&
    els.captchaSlot
  );
}

function wireEvents() {
  buildStarRating();

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
    stepImage(-1);
    clearForm();
  });

  els.nextButton.addEventListener("click", () => {
    stepImage(1);
    clearForm();
  });

  els.ratingForm.addEventListener("submit", submitRating);
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
          setStatus(
            els.connectionStatus,
            "CAPTCHA solved. Your next save will sign in automatically.",
            "ok"
          );
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

function renderRandomImage() {
  if (!state.images.length) {
    els.imageTitle.textContent = "No images found";
    return;
  }

  state.currentIndex = Math.floor(Math.random() * state.images.length);
  state.currentImage = state.images[state.currentIndex];
  renderCurrentImage();
}

function stepImage(direction) {
  if (!state.images.length || !state.currentImage) {
    return;
  }

  state.currentIndex = state.currentIndex === -1
    ? 0
    : (state.currentIndex + direction + state.images.length) % state.images.length;
  state.currentImage = state.images[state.currentIndex];
  renderCurrentImage();
}

function renderCurrentImage() {
  if (!state.currentImage) {
    return;
  }

  const nextImage = state.currentImage;
  els.imageTitle.textContent = prettifyName(nextImage.name);
  els.imageView.src = encodeURI(nextImage.path);
  els.imageView.alt = nextImage.name;
  els.imageFolder.textContent = nextImage.folder;
  els.imageLink.href = encodeURI(nextImage.path);
}

async function submitRating(event) {
  event.preventDefault();

  if (!state.supabase || !state.currentImage) {
    setStatus(els.formStatus, "Add Supabase config before submitting ratings.", "warn");
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
      .insert(payload);

    if (error) {
      throw error;
    }

    state.ratedImages[state.currentImage.path] = {
      score: payload.score,
      savedAt: new Date().toISOString()
    };
    persistLocalSession();

    setStatus(els.formStatus, "Rating saved. Loading another random image...", "ok");
    clearForm();
    renderRandomImage();
  } catch (error) {
    setStatus(els.formStatus, `Save failed: ${error.message}`, "error");
  } finally {
    els.submitButton.disabled = false;
  }
}

function clearForm() {
  els.ratingForm.reset();
  setScore(5);
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

function setScore(value) {
  state.score = Number(value.toFixed(1));
  state.hoverScore = null;
  renderScoreState();
}

function renderScoreState() {
  const displayScore = state.hoverScore ?? state.score;
  els.scoreValue.textContent = displayScore.toFixed(1);

  const buttons = els.starRating.querySelectorAll(".star-button");
  buttons.forEach((button) => {
    const whole = Number(button.dataset.whole);
    let fill = 0;

    if (displayScore >= whole) {
      fill = 1;
    } else if (displayScore === whole - 0.5) {
      fill = 0.5;
    }

    button.style.setProperty("--fill", String(fill));
    button.classList.toggle("is-active", fill > 0);
    button.classList.toggle("is-preview", state.hoverScore !== null);
    button.setAttribute("aria-checked", state.score === whole || state.score === whole - 0.5 ? "true" : "false");
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
  const halfSteps = Math.max(1, Math.min(20, Math.ceil((relativeX / width) * 20)));
  return halfSteps / 2;
}

function prettifyName(name) {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

function setStatus(element, message, tone) {
  element.textContent = message;
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

function loadLocalSession() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function persistLocalSession() {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state.ratedImages));
}
