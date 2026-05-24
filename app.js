const IMAGE_MANIFEST_PATH = "data/images.txt";
const SESSION_STORAGE_KEY = "planetary-council-rater";

const state = {
  supabase: null,
  currentImage: null,
  images: [],
  ratedImages: loadLocalSession(),
  authReady: false,
  captchaToken: null,
  captchaWidgetId: null
};

const els = {
  imageTitle: document.querySelector("#image-title"),
  imageView: document.querySelector("#image-view"),
  imageFolder: document.querySelector("#image-folder"),
  imageLink: document.querySelector("#image-link"),
  skipButton: document.querySelector("#skip-button"),
  ratingForm: document.querySelector("#rating-form"),
  submitButton: document.querySelector("#submit-button"),
  formStatus: document.querySelector("#form-status"),
  score: document.querySelector("#score"),
  scoreValue: document.querySelector("#score-value"),
  allowSeen: document.querySelector("#seen-toggle"),
  sessionButton: document.querySelector("#session-button"),
  connectionStatus: document.querySelector("#connection-status"),
  captchaSlot: document.querySelector("#captcha-slot")
};

boot();

async function boot() {
  wireEvents();
  els.submitButton.disabled = true;
  els.skipButton.disabled = true;

  try {
    state.images = await loadImages();
    renderRandomImage();
    els.skipButton.disabled = false;
  } catch (error) {
    setStatus(els.formStatus, `Could not load image manifest: ${error.message}`, "error");
  }

  setupSupabase();
}

function wireEvents() {
  els.score.addEventListener("input", () => {
    els.scoreValue.textContent = els.score.value;
  });

  els.skipButton.addEventListener("click", () => {
    renderRandomImage();
    clearForm();
  });

  els.sessionButton.addEventListener("click", startAnonymousSession);
  els.ratingForm.addEventListener("submit", submitRating);
}

async function loadImages() {
  const response = await fetch(IMAGE_MANIFEST_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => ({
      path,
      folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "root",
      name: path.split("/").pop()
    }));
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
    "Supabase configured. Start an anonymous session to enable saving.",
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
            "CAPTCHA solved. You can start the anonymous session now.",
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

async function startAnonymousSession() {
  if (!state.supabase) {
    setStatus(els.connectionStatus, "Add Supabase config before starting a session.", "warn");
    return;
  }

  const config = window.SUPABASE_CONFIG || {};
  if (config.requireCaptchaForAuth && !state.captchaToken) {
    setStatus(
      els.connectionStatus,
      "Complete the CAPTCHA first so anonymous sign-in is harder to abuse.",
      "warn"
    );
    return;
  }

  els.sessionButton.disabled = true;
  try {
    const options = state.captchaToken ? { captchaToken: state.captchaToken } : undefined;
    const { error } = await state.supabase.auth.signInAnonymously({ options });

    if (error) {
      throw error;
    }

    state.authReady = true;
    els.submitButton.disabled = false;
    setStatus(
      els.connectionStatus,
      "Anonymous session ready. Ratings will be saved to Supabase.",
      "ok"
    );
    setStatus(
      els.formStatus,
      "Session ready. Pick a score and submit your feedback.",
      "muted"
    );
  } catch (error) {
    els.sessionButton.disabled = false;
    setStatus(els.connectionStatus, `Could not start session: ${error.message}`, "error");
  }
}

function renderRandomImage() {
  if (!state.images.length) {
    els.imageTitle.textContent = "No images found";
    return;
  }

  const allowSeen = els.allowSeen.checked;
  const unseen = state.images.filter((image) => !state.ratedImages[image.path]);
  const pool = !allowSeen && unseen.length ? unseen : state.images;
  const nextImage = pool[Math.floor(Math.random() * pool.length)];
  state.currentImage = nextImage;

  els.imageTitle.textContent = prettifyName(nextImage.name);
  els.imageView.src = encodeURI(nextImage.path);
  els.imageView.alt = nextImage.name;
  els.imageFolder.textContent = nextImage.folder;
  els.imageLink.href = encodeURI(nextImage.path);
}

async function submitRating(event) {
  event.preventDefault();

  if (!state.authReady || !state.supabase || !state.currentImage) {
    setStatus(els.formStatus, "Start a session before submitting ratings.", "warn");
    return;
  }

  const formData = new FormData(els.ratingForm);
  const {
    data: { user },
    error: authError
  } = await state.supabase.auth.getUser();

  if (authError || !user) {
    setStatus(els.formStatus, "Could not resolve the active user session.", "error");
    return;
  }

  const payload = {
    user_id: user.id,
    image_path: state.currentImage.path,
    image_folder: state.currentImage.folder,
    image_name: state.currentImage.name,
    score: Number(formData.get("score")),
    negative_feedback: String(formData.get("negative") || "").trim(),
    neutral_feedback: String(formData.get("neutral") || "").trim(),
    positive_feedback: String(formData.get("positive") || "").trim()
  };

  els.submitButton.disabled = true;
  setStatus(els.formStatus, "Saving rating...", "muted");

  try {
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
    els.submitButton.disabled = !state.authReady;
  }
}

function clearForm() {
  els.ratingForm.reset();
  els.score.value = "5";
  els.scoreValue.textContent = "5";
}

function prettifyName(name) {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

function setStatus(element, message, tone) {
  element.textContent = message;
  element.className = `status-card status-${tone}`;
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
