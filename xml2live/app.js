(function () {
  const API_ENDPOINT = (window.XML2LIVE_API_URL || "https://xml2live-api.vercel.app/api/xml2live").trim();
  const blankPosterUrl =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><rect width="600" height="900" fill="#1a2833"/></svg>',
    );
  const XML_MIME_PATTERN = /(text\/xml|application\/xml|\.xml$)/i;
  const REFERENCE_EXTENSIONS = /(mov|mp4|m4v|mpg|mpeg|avi|mkv|h264)$/i;

  const state = {
    xmlFile: null,
    xmlText: "",
    xmlSummary: null,
    referenceFile: null,
    referenceDurationSeconds: 0,
  };

  const els = {
    poster: document.querySelector("#poster"),
    referenceZone: document.querySelector("#reference-zone"),
    referenceVideoLabel: document.querySelector("#reference-video-label"),
    referenceVideoName: document.querySelector("#reference-video-name"),
    referenceInput: document.querySelector("#reference-input"),
    sequenceName: document.querySelector("#sequence-name"),
    sequenceYear: document.querySelector("#sequence-year"),
    sequenceMeta: document.querySelector("#sequence-meta"),
    xmlPath: document.querySelector("#xml-path"),
    dropZone: document.querySelector("#drop-zone"),
    xmlInput: document.querySelector("#xml-input"),
    projectName: document.querySelector("#project-name"),
    abletonVersion: document.querySelector("#ableton-version"),
    importMetadata: document.querySelector("#import-metadata"),
    status: document.querySelector("#status"),
    convert: document.querySelector("#convert"),
    progressOverlay: document.querySelector("#progress-overlay"),
    progressTitle: document.querySelector("#progress-title"),
    progressMessage: document.querySelector("#progress-message"),
    toast: document.querySelector("#toast"),
  };

  els.poster.src = blankPosterUrl;
  els.poster.dataset.defaultSrc = blankPosterUrl;

  function basenameOf(name) {
    return String(name).split(/[\/\\]/).pop() || name;
  }

  function stemOf(name) {
    return basenameOf(name).replace(/\.[^.]+$/, "");
  }

  function setStatus(message) {
    els.status.textContent = message;
  }

  function setBusy(isBusy) {
    els.convert.disabled = isBusy;
    els.dropZone.disabled = isBusy;
    els.referenceZone.disabled = isBusy;
    els.importMetadata.disabled = isBusy;
    els.abletonVersion.disabled = isBusy;
    els.convert.textContent = isBusy ? "PREPARING..." : "CONVERT";
  }

  function setProgress(isVisible, title, message) {
    els.progressOverlay.classList.toggle("visible", isVisible);
    els.progressOverlay.setAttribute("aria-hidden", String(!isVisible));
    if (title) els.progressTitle.textContent = title;
    if (message) els.progressMessage.textContent = message;
  }

  let toastTimer = null;

  function showToast(message) {
    if (toastTimer) window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("visible");
    els.toast.setAttribute("aria-hidden", "false");
    toastTimer = window.setTimeout(() => {
      els.toast.classList.remove("visible");
      els.toast.setAttribute("aria-hidden", "true");
    }, 2600);
  }

  function waitForUiPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function guessYear(texts) {
    for (const text of texts) {
      if (!text) continue;
      const match = String(text).match(/(19|20)\d{2}/);
      if (match) return match[0];
    }
    return "";
  }

  function parseTimelineSummary(xmlText, fileName) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) {
      throw new Error("That XML could not be parsed in the browser.");
    }

    const sequence = doc.querySelector("sequence");
    if (!sequence) {
      throw new Error("This does not look like a Premiere/FCP7-style XML export.");
    }

    const sequenceName = sequence.querySelector(":scope > name")?.textContent?.trim() || stemOf(fileName);
    const audioTracks = Array.from(sequence.querySelectorAll("media > audio > track"));
    const markers = Array.from(sequence.querySelectorAll(":scope > marker"));
    const clips = Array.from(sequence.querySelectorAll("media > audio > track > clipitem"));
    const year = guessYear([
      fileName,
      sequenceName,
      ...clips.slice(0, 50).map((clip) => clip.querySelector("name")?.textContent || ""),
    ]);

    return {
      sequenceName,
      audioTrackCount: audioTracks.length,
      clipCount: clips.length,
      markerCount: markers.length,
      year,
    };
  }

  function updateSequence(summary) {
    els.sequenceName.textContent = summary.sequenceName;
    els.sequenceYear.textContent = summary.year ? `(${summary.year})` : "";
    els.sequenceMeta.textContent = `${summary.audioTrackCount} audio tracks`;
    els.xmlPath.textContent = summary.sequenceName;
    if (!els.projectName.value.trim()) {
      els.projectName.value = summary.sequenceName || "XML2LIVE Set";
    }
  }

  async function loadXmlFile(file) {
    if (!file) return;
    setBusy(true);
    try {
      const xmlText = await file.text();
      const summary = parseTimelineSummary(xmlText, file.name);
      state.xmlFile = file;
      state.xmlText = xmlText;
      state.xmlSummary = summary;
      updateSequence(summary);
      setStatus(`Parsed ${summary.clipCount} clips across ${summary.audioTrackCount} audio tracks. Ready for web conversion.`);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function capturePosterFromFile(file) {
    const objectUrl = URL.createObjectURL(file);
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;

      const finish = (result) => {
        URL.revokeObjectURL(objectUrl);
        resolve(result);
      };

      video.addEventListener("error", () => finish({ durationSeconds: 0, previewUrl: "" }), { once: true });
      video.addEventListener(
        "loadedmetadata",
        () => {
          const duration = Number.isFinite(video.duration) ? video.duration : 0;
          if (!duration) {
            finish({ durationSeconds: 0, previewUrl: "" });
            return;
          }
          video.currentTime = Math.min(Math.max(duration * 0.14, 0.2), Math.max(duration - 0.2, 0.2));
        },
        { once: true },
      );
      video.addEventListener(
        "seeked",
        () => {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 600;
          canvas.height = video.videoHeight || 900;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            finish({ durationSeconds: video.duration || 0, previewUrl: "" });
            return;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish({
            durationSeconds: video.duration || 0,
            previewUrl: canvas.toDataURL("image/jpeg", 0.88),
          });
        },
        { once: true },
      );

      video.src = objectUrl;
    });
  }

  async function loadReferenceFile(file) {
    state.referenceFile = file;
    state.referenceVideoLabel.textContent = stemOf(file.name);
    state.referenceDurationSeconds = 0;
    const result = await capturePosterFromFile(file);
    state.referenceDurationSeconds = result.durationSeconds || 0;
    els.poster.src = result.previewUrl || els.poster.dataset.defaultSrc;
    setStatus("Reference video added.");
  }

  function isXmlFile(file) {
    return file && (XML_MIME_PATTERN.test(file.type) || file.name.toLowerCase().endsWith(".xml"));
  }

  function isReferenceFile(file) {
    return file && REFERENCE_EXTENSIONS.test(file.name || "");
  }

  function downloadBlob(filename, blob) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }

  async function postToBackend(payload) {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/zip") || contentType.includes("application/octet-stream")) {
      const blob = await response.blob();
      downloadBlob(`${payload.projectName || "XML2LIVE Set"}.zip`, blob);
      return "zip";
    }

    const json = await response.json();
    downloadBlob(
      `${(payload.projectName || "XML2LIVE Set").replace(/[\\/:*?"<>|]/g, "_")} - response.json`,
      new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }),
    );
    return "json";
  }

  async function convert() {
    if (!state.xmlFile || !state.xmlSummary) {
      setStatus("Choose or drop an XML first.");
      return;
    }

    const projectName = els.projectName.value.trim() || state.xmlSummary.sequenceName || "XML2LIVE Set";
    const payload = {
      app: "XML2LIVE Web",
      createdAt: new Date().toISOString(),
      projectName,
      abletonVersion: els.abletonVersion.value,
      importMetadata: els.importMetadata.checked,
      xml: {
        fileName: state.xmlFile.name,
        summary: state.xmlSummary,
        text: state.xmlText,
      },
      referenceMedia: state.referenceFile
        ? {
            fileName: state.referenceFile.name,
            mimeType: state.referenceFile.type || "",
            durationSeconds: state.referenceDurationSeconds || 0,
          }
        : null,
    };

    setBusy(true);
    setProgress(true, "Preparing conversion...", "XML2LIVE is packaging the browser request.");
    await waitForUiPaint();

    try {
      try {
        const mode = await postToBackend(payload);
        setStatus(`Backend conversion finished. Downloaded ${mode === "zip" ? "zip" : "response payload"}.`);
        showToast("Conversion complete");
      } catch (_error) {
        downloadBlob(
          `${projectName.replace(/[\\/:*?"<>|]/g, "_") || "XML2LIVE Set"} - web payload.json`,
          new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
        );
        setStatus("Frontend is live, but no `/api/xml2live` backend is deployed yet. Downloaded a conversion payload instead.");
        showToast("Web payload downloaded");
      }
    } finally {
      setProgress(false);
      setBusy(false);
    }
  }

  function attachDropEvents() {
    [els.dropZone, els.referenceZone].forEach((target) => {
      ["dragenter", "dragover"].forEach((eventName) => {
        target.addEventListener(eventName, (event) => {
          event.preventDefault();
          target.classList.add("drag-over");
        });
      });
      ["dragleave", "drop"].forEach((eventName) => {
        target.addEventListener(eventName, (event) => {
          event.preventDefault();
          target.classList.remove("drag-over");
        });
      });
    });

    els.dropZone.addEventListener("drop", async (event) => {
      const file = Array.from(event.dataTransfer?.files || []).find(isXmlFile);
      if (file) await loadXmlFile(file);
    });

    els.referenceZone.addEventListener("drop", async (event) => {
      const file = Array.from(event.dataTransfer?.files || []).find(isReferenceFile);
      if (file) await loadReferenceFile(file);
    });
  }

  els.dropZone.addEventListener("click", () => els.xmlInput.click());
  els.referenceZone.addEventListener("click", () => els.referenceInput.click());
  els.xmlInput.addEventListener("change", async () => {
    const file = els.xmlInput.files && els.xmlInput.files[0];
    if (file) await loadXmlFile(file);
  });
  els.referenceInput.addEventListener("change", async () => {
    const file = els.referenceInput.files && els.referenceInput.files[0];
    if (file) await loadReferenceFile(file);
  });
  els.convert.addEventListener("click", convert);
  attachDropEvents();
})();
