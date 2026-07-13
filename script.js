/* ==========================================================================
   Cinematic Scroll-Driven Frame Sequence
   - Preloads 121 PNG frames
   - Maps scroll position -> frame index (with smooth interpolation)
   - Renders to a fullscreen, high-DPI <canvas> via requestAnimationFrame
   ========================================================================== */

(() => {
  "use strict";

  /* ------------------------------------------------------------------
     Configuration
     ------------------------------------------------------------------ */
  const TOTAL_FRAMES = 121;
  const FRAME_PATH = (index) =>
    `frames/frame_${String(index).padStart(4, "0")}.png`;

  // Lerp factor controlling how quickly the rendered frame "catches up"
  // to the scroll-derived target frame. Lower = smoother/slower.
  const LERP_FACTOR = 0.12;
  const SCROLL_SECTION_HEIGHT_MULTIPLIER = 2; // 200vh — shorter, still smooth

  /* ------------------------------------------------------------------
     DOM References
     ------------------------------------------------------------------ */
  const canvas = document.getElementById("frameCanvas");
  const scrollSection = document.getElementById("scrollSection");
  
  if (!canvas || !scrollSection) {
      const loaderEl = document.getElementById("loader");
      if (loaderEl) loaderEl.classList.add("loader--hidden");
      document.body.classList.remove("is-loading");
      return;
  }

  const ctx = canvas.getContext("2d", { alpha: false });
  const loader = document.getElementById("loader");
  const loaderPercentage = document.getElementById("loaderPercentage");
  const loaderBarFill = document.getElementById("loaderBarFill");
  const heroOverlay = document.getElementById("heroOverlay");
  const scrollCue = document.getElementById("scrollCue");
  const scrollProgressFill = document.getElementById("scrollProgressFill");

  /* ------------------------------------------------------------------
     State
     ------------------------------------------------------------------ */
  const frames = new Array(TOTAL_FRAMES);
  let loadedCount = 0;

  let currentFrameFloat = 1;
  let targetFrame = 1;
  let lastDrawnFrame = -1;

  let canvasWidth = 0;
  let canvasHeight = 0;
  let dpr = 1;

  let lastSectionWidth = 0;
  let lastSectionHeight = 0;

  let assetsReady = false;

  /* ------------------------------------------------------------------
     Preloading
     ------------------------------------------------------------------ */
  function loadFrame(index) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";

      const finalize = () => {
        loadedCount += 1;
        updateLoaderProgress(loadedCount);
        resolve(img);
      };

      img.onload = () => {
        if ("decode" in img) {
          img.decode().then(finalize).catch(finalize);
        } else {
          finalize();
        }
      };
      img.onerror = finalize;

      img.src = FRAME_PATH(index);
    });
  }

  function preloadAllFrames() {
    const loadPromises = [];
    for (let i = 1; i <= TOTAL_FRAMES; i++) {
      loadPromises.push(
        loadFrame(i).then((img) => {
          frames[i - 1] = img;
        })
      );
    }
    return Promise.all(loadPromises);
  }

  function updateLoaderProgress(count) {
    const pct = Math.min(
      100,
      Math.round((count / TOTAL_FRAMES) * 100)
    );
    loaderPercentage.textContent = `${pct}%`;
    loaderBarFill.style.width = `${pct}%`;
  }

  function hideLoader() {
    loader.classList.add("loader--hidden");
    document.body.classList.remove("is-loading");
  }

  /* ------------------------------------------------------------------
     Canvas Sizing (high-DPI aware)
     ------------------------------------------------------------------ */
  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvasWidth = window.innerWidth;
    canvasHeight = window.innerHeight;

    canvas.width = Math.round(canvasWidth * dpr);
    canvas.height = Math.round(canvasHeight * dpr);
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Mobile browsers fire resize events when their address bar shows
    // or hides while scrolling — that's a small height-only delta with
    // an unchanged width. Recomputing the scroll section's total height
    // in that case would shift the scroll-to-frame mapping mid-scroll
    // and jump the canvas to a different frame. Only recompute the
    // scrollable distance on an actual width change or a substantial
    // height change (real resize/orientation change), not UI-chrome noise.
    const widthChanged = canvasWidth !== lastSectionWidth;
    const heightChangedALot =
      Math.abs(canvasHeight - lastSectionHeight) > 150;
    const isFirstRun = lastSectionWidth === 0;

    if (isFirstRun || widthChanged || heightChangedALot) {
      lastSectionWidth = canvasWidth;
      lastSectionHeight = canvasHeight;

      // Set the scroll section's height explicitly using the real
      // viewport height — avoids mobile browser vh quirks.
      scrollSection.style.height = `${
        canvasHeight * SCROLL_SECTION_HEIGHT_MULTIPLIER
      }px`;

      // Resync the target frame against the new scrollable distance —
      // without this, resizing/rotating leaves the canvas showing a
      // frame computed from the stale viewport height until the next
      // scroll event fires.
      onScroll();
    }

    // Force a redraw of the current frame at the new size.
    lastDrawnFrame = -1;
    drawFrame(Math.round(currentFrameFloat));
  }

  /* ------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------ */
  function drawFrame(frameNumber) {
    const clampedIndex = Math.min(
      Math.max(frameNumber, 1),
      TOTAL_FRAMES
    );
    const img = frames[clampedIndex - 1];

    if (!img || !img.complete || img.naturalWidth === 0) {
      return;
    }

    // Clear / background fill
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // "cover" fit calculation — fill the canvas while preserving
    // the image's aspect ratio, cropping overflow as needed.
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const canvasRatio = canvasWidth / canvasHeight;

    let drawWidth;
    let drawHeight;
    let offsetX;
    let offsetY;

    if (imgRatio > canvasRatio) {
      drawHeight = canvasHeight;
      drawWidth = drawHeight * imgRatio;
      offsetX = (canvasWidth - drawWidth) / 2;
      offsetY = 0;
    } else {
      drawWidth = canvasWidth;
      drawHeight = drawWidth / imgRatio;
      offsetX = 0;
      offsetY = (canvasHeight - drawHeight) / 2;
    }

    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
  }

  /* ------------------------------------------------------------------
     Scroll Handling
     ------------------------------------------------------------------ */
  function getScrollProgress() {
    const rect = scrollSection.getBoundingClientRect();
    const totalScrollable = scrollSection.offsetHeight - window.innerHeight;

    if (totalScrollable <= 0) return 0;

    const scrolled = -rect.top;
    const progress = scrolled / totalScrollable;

    return Math.min(Math.max(progress, 0), 1);
  }

  function onScroll() {
    const progress = getScrollProgress();

    // Map [0, 1] scroll progress -> [1, TOTAL_FRAMES] frame index.
    targetFrame = 1 + progress * (TOTAL_FRAMES - 1);

    // Update progress bar.
    scrollProgressFill.style.transform = `scaleX(${progress})`;

    // Fade out hero overlay & scroll cue as the user begins scrolling.
    const fadeRange = 0.12; // fully faded by 12% scroll progress
    const fadeAmount = Math.min(progress / fadeRange, 1);
    const opacity = 1 - fadeAmount;
    const translateY = fadeAmount * -24;

    heroOverlay.style.opacity = opacity;
    heroOverlay.style.transform = `translateY(${translateY}px)`;
    scrollCue.style.opacity = opacity;
  }

  /* ------------------------------------------------------------------
     Animation Loop (requestAnimationFrame)
     ------------------------------------------------------------------ */
  function renderLoop() {
    const diff = targetFrame - currentFrameFloat;

    if (Math.abs(diff) > 0.01) {
      currentFrameFloat += diff * LERP_FACTOR;
    } else {
      currentFrameFloat = targetFrame;
    }

    if (assetsReady) {
      const frameToRender = Math.round(currentFrameFloat);
      if (frameToRender !== lastDrawnFrame) {
        drawFrame(frameToRender);
        lastDrawnFrame = frameToRender;
      }
    }

    requestAnimationFrame(renderLoop);
  }

  /* ------------------------------------------------------------------
     Init
     ------------------------------------------------------------------ */
  function init() {
    resizeCanvas();

    window.addEventListener("resize", resizeCanvas, { passive: true });
    window.addEventListener("orientationchange", resizeCanvas, {
      passive: true,
    });
    window.addEventListener("scroll", onScroll, { passive: true });

    // Start the render loop immediately so the UI feels responsive
    // the instant assets finish loading.
    requestAnimationFrame(renderLoop);

    preloadAllFrames().then(() => {
      assetsReady = true;
      lastDrawnFrame = -1;
      drawFrame(1);
      onScroll();
      hideLoader();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* ==========================================================================
   Scroll-reveal — IntersectionObserver for section animations
   ========================================================================== */
(function initReveal() {
  const revealEls = document.querySelectorAll(".reveal-child");
  if (!revealEls.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  revealEls.forEach((el) => observer.observe(el));
}());

/* ==========================================================================
   Animated number counters for About stats
   ========================================================================== */
(function initCounters() {
  const counters = document.querySelectorAll(".stat-card__num[data-target]");
  if (!counters.length) return;

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  const animateCounter = (el) => {
    const target = parseInt(el.dataset.target, 10);
    const duration = 1800;
    const start = performance.now();

    const tick = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      el.textContent = Math.round(easeOut(progress) * target);
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = target;
    };
    requestAnimationFrame(tick);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.5 }
  );

  counters.forEach((el) => observer.observe(el));
}());

/* ==========================================================================
   Contact form — basic submit feedback
   ========================================================================== */
(function initContactForm() {
  const form = document.getElementById("contactForm");
  if (!form) return;

  const WHATSAPP_NUMBER = "919600200113";

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const name  = form.querySelector("#fname").value.trim();
    const email = form.querySelector("#femail").value.trim();
    const phone = form.querySelector("#fphone").value.trim();
    const msg   = form.querySelector("#fmsg").value.trim();

    const lines = [
      "*New Enquiry — Radha Decors*",
      `Name: ${name}`,
      `Email: ${email}`,
    ];
    if (phone) lines.push(`Phone: ${phone}`);
    lines.push(`Message: ${msg}`);

    const waText = encodeURIComponent(lines.join("\n"));
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${waText}`, "_blank");

    const btn = form.querySelector("button[type='submit']");
    btn.textContent = "Opening WhatsApp...";
    btn.style.background = "linear-gradient(135deg, #25D366, #128C7E)";
    setTimeout(() => {
      btn.innerHTML = 'Send Message <i class="fa-solid fa-paper-plane"></i>';
      btn.style.background = "";
      form.reset();
    }, 3000);
  });
}());

/* ==========================================================================
   Services Section — GSAP ScrollTrigger luxury animations
   ========================================================================== */
(function initServicesAnimations() {
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") return;

  /* ── Ambient particles ── */
  const container = document.getElementById("srvParticles");
  if (container) {
    for (let i = 0; i < 18; i++) {
      const p = document.createElement("div");
      p.className = "srv-particle";
      const size = 3 + Math.random() * 8;
      p.style.cssText = `width:${size}px;height:${size}px;left:${Math.random()*100}%;bottom:${Math.random()*80}%;--dur:${7+Math.random()*9}s;--delay:${Math.random()*7}s;`;
      container.appendChild(p);
    }
  }

  /* ── Eyebrow + ornaments fade ── */
  gsap.from(".srv-eyebrow", {
    opacity: 0, y: 20, duration: 0.8, ease: "power2.out",
    scrollTrigger: { trigger: ".srv-header", start: "top 82%" }
  });

  /* ── Title letters rise ── */
  gsap.from("#srvTitle", {
    opacity: 0, y: 60, duration: 1, ease: "power3.out",
    scrollTrigger: { trigger: "#srvTitle", start: "top 85%" }
  });

  /* ── Divider lines expand from center ── */
  gsap.from(".srv-divider__line", {
    scaleX: 0,
    duration: 0.9,
    ease: "power2.out",
    stagger: 0.1,
    scrollTrigger: { trigger: "#srvDivider", start: "top 88%" }
  });

  /* ── Script + lead fade ── */
  gsap.from([".srv-script", ".srv-lead"], {
    opacity: 0, y: 20, stagger: 0.15, duration: 0.8, ease: "power2.out",
    scrollTrigger: { trigger: ".srv-script", start: "top 88%" }
  });

  /* ── Cards stagger reveal ── */
  gsap.from(".srv-card-outer", {
    opacity: 0,
    y: 60,
    stagger: 0.15,
    duration: 0.85,
    ease: "power2.out",
    scrollTrigger: {
      trigger: "#srvGrid",
      start: "top 80%"
    }
  });

  /* ── Features bar stagger ── */
  gsap.from(".srv-feat", {
    opacity: 0,
    y: 35,
    stagger: 0.12,
    duration: 0.7,
    ease: "power2.out",
    scrollTrigger: {
      trigger: "#srvFeatures",
      start: "top 88%"
    }
  });
}());

/* ==========================================================================
   About Section — GSAP ScrollTrigger luxury animations
   ========================================================================== */
(function initAboutAnimations() {
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") return;

  gsap.registerPlugin(ScrollTrigger);

  const section = document.querySelector(".s-about");
  if (!section) return;

  /* ── Ambient floating particles ── */
  const particlesContainer = document.getElementById("aboutParticles");
  if (particlesContainer) {
    const PARTICLE_COUNT = 22;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = document.createElement("div");
      p.className = "about-particle";
      const size = 4 + Math.random() * 10;
      p.style.cssText = `
        width:${size}px; height:${size}px;
        left:${Math.random() * 100}%;
        bottom:${Math.random() * 60}%;
        --dur:${6 + Math.random() * 8}s;
        --delay:${Math.random() * 6}s;
      `;
      particlesContainer.appendChild(p);
    }
  }

  /* ── Mouse spotlight ── */
  const spotlight = document.getElementById("aboutSpotlight");
  if (spotlight) {
    section.addEventListener("mousemove", (e) => {
      const rect = section.getBoundingClientRect();
      spotlight.style.left = (e.clientX - rect.left) + "px";
      spotlight.style.top  = (e.clientY - rect.top)  + "px";
    });
  }

  /* ── Image clip-path reveal ── */
  const imgClip = document.getElementById("aboutImgClip");
  if (imgClip) {
    gsap.fromTo(imgClip,
      { clipPath: "polygon(0 0, 0% 0, 0% 100%, 0 100%)" },
      {
        clipPath: "polygon(0 0, 85% 0, 100% 100%, 0 100%)",
        duration: 1.4,
        ease: "power3.inOut",
        scrollTrigger: {
          trigger: section,
          start: "top 75%",
          toggleActions: "play none none none"
        }
      }
    );
  }

  /* ── Image parallax scrub ── */
  const aboutImg = document.getElementById("aboutImg");
  if (aboutImg) {
    gsap.fromTo(aboutImg,
      { yPercent: -8 },
      {
        yPercent: 8,
        ease: "none",
        scrollTrigger: {
          trigger: section,
          start: "top bottom",
          end: "bottom top",
          scrub: 1.2
        }
      }
    );
  }

  /* ── Light sweep trigger once image is in view ── */
  const sweep = document.getElementById("aboutImgSweep");
  if (sweep) {
    ScrollTrigger.create({
      trigger: section,
      start: "top 70%",
      onEnter: () => { sweep.style.animationPlayState = "running"; }
    });
  }

  /* ── Content stagger reveal ── */
  const eyebrow  = document.getElementById("aboutEyebrow");
  const brand    = document.getElementById("aboutBrand");
  const tagline  = document.getElementById("aboutTagline");
  const body     = document.getElementById("aboutBody");

  const contentTl = gsap.timeline({
    scrollTrigger: {
      trigger: section,
      start: "top 70%",
      toggleActions: "play none none none"
    }
  });

  if (eyebrow)  contentTl.from(eyebrow,  { opacity: 0, y: 28, duration: 0.7, ease: "power2.out" }, 0.15);
  if (brand)    contentTl.from(brand,    { opacity: 0, y: 34, duration: 0.8, ease: "power3.out" }, 0.3);
  if (tagline)  contentTl.from(tagline,  { opacity: 0, y: 22, duration: 0.7, ease: "power2.out" }, 0.48);
  if (body)     contentTl.from(body,     { opacity: 0, y: 18, duration: 0.7, ease: "power2.out" }, 0.62);

  /* ── Feature cards stagger ── */
  const featCards = gsap.utils.toArray(".feat-card");
  if (featCards.length) {
    gsap.from(featCards, {
      opacity: 0,
      y: 36,
      stagger: 0.12,
      duration: 0.7,
      ease: "power2.out",
      scrollTrigger: {
        trigger: document.getElementById("aboutFeats"),
        start: "top 82%",
        toggleActions: "play none none none"
      }
    });
  }

  /* ── Specialty spec items stagger ── */
  const specItems = gsap.utils.toArray(".spec-item");
  if (specItems.length) {
    gsap.from(specItems, {
      opacity: 0,
      y: 28,
      scale: 0.85,
      stagger: 0.09,
      duration: 0.6,
      ease: "back.out(1.4)",
      scrollTrigger: {
        trigger: document.querySelector(".about-specs__items"),
        start: "top 88%",
        toggleActions: "play none none none"
      }
    });
  }

  /* ── Quote fade-in ── */
  const quote = document.getElementById("aboutSpecsQuote");
  if (quote) {
    gsap.from(quote, {
      opacity: 0,
      x: 30,
      duration: 0.9,
      ease: "power2.out",
      scrollTrigger: {
        trigger: quote,
        start: "top 88%",
        toggleActions: "play none none none"
      }
    });
  }

  /* ── SVG border shimmer pulse via GSAP ── */
  const shapeBorder = document.querySelector(".about-shape-border polygon");
  if (shapeBorder) {
    gsap.to(shapeBorder, {
      attr: { "stroke-opacity": 0.3 },
      duration: 2,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut"
    });
  }
}());

/* ==========================================================================
   Navbar — mobile toggle & active-link tracking
   ========================================================================== */
(function initNavbar() {
  const menuToggle = document.getElementById("menuToggle");
  const navLinks   = document.getElementById("navLinks");
  const navItems   = document.querySelectorAll(".nav-item");
  const navbar     = document.getElementById("mainNavbar");

  if (!menuToggle || !navLinks) return;

  const dropdownItem   = document.querySelector(".nav-item.dropdown");
  const dropdownToggle = document.querySelector(".dropdown-toggle");

  function closeDropdown() {
    if (!dropdownItem || !dropdownToggle) return;
    dropdownItem.classList.remove("open");
    dropdownToggle.setAttribute("aria-expanded", "false");
  }

  // Mobile hamburger toggle
  menuToggle.addEventListener("click", () => {
    navLinks.classList.toggle("open");
    if (navLinks.classList.contains("open")) {
      // The open menu lives inside the header itself, so it must stay
      // visible even if the user had already scrolled past the
      // auto-hide threshold below.
      navbar.classList.remove("navbar--hidden");
    } else {
      closeDropdown();
    }
  });

  // Close menu & mark active on nav link click
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      navItems.forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      navLinks.classList.remove("open");
      closeDropdown();
    });
  });

  // Products dropdown — on mobile/tablet there's no hover, so a chevron
  // button expands/collapses the product list instead. It must stop the
  // click from bubbling to the .nav-item listener above, or opening the
  // submenu would immediately close the whole mobile menu.
  if (dropdownItem && dropdownToggle) {
    dropdownToggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = dropdownItem.classList.toggle("open");
      dropdownToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
  }

  // Highlight active nav link based on scroll position.
  // Resolve each section's link once up front instead of re-querying
  // the DOM on every scroll tick.
  const sectionLinks = Array.from(document.querySelectorAll("section[id]"))
    .map((section) => ({
      section,
      link: document.querySelector(`.nav-item[href="#${section.getAttribute("id")}"]`),
    }))
    .filter((entry) => entry.link);

  let scrollTicking = false;

  function updateOnScroll() {
    const scrollPos = window.scrollY + 140;

    let activeLink = null;
    sectionLinks.forEach(({ section, link }) => {
      const top    = section.offsetTop;
      const bottom = top + section.offsetHeight;
      if (scrollPos >= top && scrollPos < bottom) {
        activeLink = link;
      }
    });

    if (activeLink) {
      navItems.forEach((i) => i.classList.remove("active"));
      activeLink.classList.add("active");
    }

    // Hide navbar as soon as user scrolls down — but never while the
    // mobile menu is open, or it disappears along with its own menu.
    if (navLinks.classList.contains("open")) {
      navbar.classList.remove("navbar--hidden");
    } else if (window.scrollY > 60) {
      navbar.classList.add("navbar--hidden");
    } else {
      navbar.classList.remove("navbar--hidden");
    }

    scrollTicking = false;
  }

  // Throttle to at most one update per animation frame so fast/continuous
  // scroll events (especially on mobile) don't stack up and cause jank.
  window.addEventListener("scroll", () => {
    if (!scrollTicking) {
      scrollTicking = true;
      requestAnimationFrame(updateOnScroll);
    }
  }, { passive: true });
}());

/* ==========================================================================
   Gallery — curved 3D carousel (auto-rotates, drag/swipe to spin)
   ========================================================================== */
(function initGalleryCarousel() {
  const carousel = document.getElementById("galleryCarousel");
  const track = document.getElementById("galleryTrack");
  if (!carousel || !track) return;

  const cards = Array.from(track.querySelectorAll(".gallery-card"));
  const count = cards.length;
  if (!count) return;

  const angleStep = 360 / count;
  const AUTO_SPEED = 0.045; // degrees per frame
  const DRAG_SENSITIVITY = 0.32;
  const RESUME_DELAY = 1800; // ms after release before auto-rotate resumes

  let radius = 0;
  let rotation = 0;
  let isDragging = false;
  let autoPaused = false;
  let lastX = 0;
  let resumeTimer = null;

  // Click-vs-drag detection, so a tap opens the lightbox but a drag spins the carousel.
  let pressStartX = 0;
  let pressStartY = 0;
  let pressStartTime = 0;
  let pressTotalMove = 0;
  let pressTarget = null;
  const CLICK_MOVE_THRESHOLD = 6; // px
  const CLICK_TIME_THRESHOLD = 400; // ms

  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightboxImg");
  const lightboxClose = document.getElementById("lightboxClose");

  function openLightbox(card) {
    const img = card.querySelector("img");
    if (!img || !lightbox || !lightboxImg) return;
    lightboxImg.src = img.currentSrc || img.src;
    lightboxImg.alt = img.alt || "";
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
  }

  if (lightboxClose) lightboxClose.addEventListener("click", closeLightbox);
  if (lightbox) {
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) closeLightbox();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });

  function layoutCards() {
    // Radius scales with card width so cards never overlap, regardless of viewport.
    const cardWidth = cards[0].getBoundingClientRect().width || 230;
    radius = Math.round((cardWidth / 2) / Math.tan(Math.PI / count)) + 40;

    cards.forEach((card, i) => {
      card.style.transform = `rotateY(${i * angleStep}deg) translateZ(${radius}px)`;
    });
  }

  function applyRotation() {
    track.style.transform = `rotateY(${rotation}deg)`;
  }

  function tick() {
    if (!isDragging && !autoPaused) {
      rotation += AUTO_SPEED;
      applyRotation();
    }
    requestAnimationFrame(tick);
  }

  function getClientPos(e) {
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
    return { x: t.clientX, y: t.clientY };
  }

  function onPointerDown(e) {
    const pos = getClientPos(e);
    isDragging = true;
    autoPaused = true;
    lastX = pos.x;
    pressStartX = pos.x;
    pressStartY = pos.y;
    pressStartTime = Date.now();
    pressTotalMove = 0;
    pressTarget = e.target;
    clearTimeout(resumeTimer);
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const pos = getClientPos(e);
    rotation += (pos.x - lastX) * DRAG_SENSITIVITY;
    pressTotalMove += Math.abs(pos.x - pressStartX) + Math.abs(pos.y - pressStartY);
    lastX = pos.x;
    applyRotation();
  }

  function onPointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      autoPaused = false;
    }, RESUME_DELAY);

    const elapsed = Date.now() - pressStartTime;
    if (pressTotalMove < CLICK_MOVE_THRESHOLD && elapsed < CLICK_TIME_THRESHOLD && pressTarget) {
      const card = pressTarget.closest && pressTarget.closest(".gallery-card");
      if (card) openLightbox(card);
    }
  }

  carousel.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  carousel.addEventListener("touchstart", onPointerDown, { passive: true });
  window.addEventListener("touchmove", onPointerMove, { passive: true });
  window.addEventListener("touchend", onPointerUp);
  window.addEventListener("resize", layoutCards, { passive: true });

  layoutCards();
  requestAnimationFrame(tick);
}());
