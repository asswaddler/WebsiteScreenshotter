const statusEl = document.getElementById("status");
const captureButton = document.getElementById("capture");
const hideFixedCheckbox = document.getElementById("hideFixed");
const warmupCheckbox = document.getElementById("warmupLazy");
const autoExpandCheckbox = document.getElementById("autoExpand");

const CONFIG = {
  scrollDelayMs: 300,
  warmupDelayMs: 350,
  warmupStepPx: 600,
  tileOverlapPx: 0,
  maxCanvasHeightPx: 32767,
  autoExpandStepPx: 800,
  autoExpandDelayMs: 400,
  autoExpandSettleRounds: 3,
  autoExpandMaxRounds: 80
};

const setStatus = (message) => {
  statusEl.textContent = message;
};

const getActiveTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error("No active tab found.");
  }
  return tab;
};

const sendToContent = (tabId, message) =>
  chrome.tabs.sendMessage(tabId, message);

const captureVisible = async (windowId) => {
  const response = await chrome.runtime.sendMessage({
    type: "CAPTURE_VISIBLE_TAB",
    windowId
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Failed to capture visible tab.");
  }
  return response.dataUrl;
};

const downloadPng = async (dataUrl, filename) => {
  const response = await chrome.runtime.sendMessage({
    type: "DOWNLOAD_PNG",
    dataUrl,
    filename
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Failed to save PNG.");
  }
  return response.downloadId;
};

const dataUrlToBitmap = async (dataUrl) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
};

const autoExpandContent = async (tabId) => {
  const response = await sendToContent(tabId, {
    type: "AUTO_EXPAND",
    options: {
      step: CONFIG.autoExpandStepPx,
      delay: CONFIG.autoExpandDelayMs,
      settleRounds: CONFIG.autoExpandSettleRounds,
      maxRounds: CONFIG.autoExpandMaxRounds
    }
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to auto-expand content.");
  }

  return response.result;
};

const createCanvas = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const drawTile = (parts, image, tileTopPx, tileHeightPx, partHeightPx) => {
  const tileBottomPx = tileTopPx + tileHeightPx;
  let remainingTop = tileTopPx;
  let remainingHeight = tileHeightPx;

  while (remainingHeight > 0) {
    const partIndex = Math.floor(remainingTop / partHeightPx);
    const part = parts[partIndex];
    const partTopPx = partIndex * partHeightPx;
    const drawTopPx = remainingTop - partTopPx;
    const availableHeight = Math.min(
      partHeightPx - drawTopPx,
      remainingHeight
    );

    const sourceOffset = tileHeightPx - remainingHeight;
    part.ctx.drawImage(
      image,
      0,
      sourceOffset,
      image.width,
      availableHeight,
      0,
      drawTopPx,
      image.width,
      availableHeight
    );

    remainingTop += availableHeight;
    remainingHeight -= availableHeight;
  }
};

const runCapture = async () => {
  captureButton.disabled = true;
  setStatus("Starting capture…");

  const tab = await getActiveTab();
  const tabId = tab.id;

  if (hideFixedCheckbox.checked) {
    await sendToContent(tabId, { type: "HIDE_FIXED" });
  }

  if (warmupCheckbox.checked) {
    setStatus("Warming up lazy-loaded content…");
    await sendToContent(tabId, {
      type: "WARMUP_LAZY",
      step: CONFIG.warmupStepPx,
      delay: CONFIG.warmupDelayMs
    });
  }

  if (autoExpandCheckbox.checked) {
    setStatus("Auto-scrolling to load extra content…");
    await autoExpandContent(tabId);
  }

  const metrics = await sendToContent(tabId, { type: "GET_PAGE_METRICS" });
  const { totalHeight, viewport, devicePixelRatio } = metrics;
  const dpr = devicePixelRatio || 1;
  const viewportHeight = viewport.height;
  const viewportWidth = viewport.width;

  const totalHeightPx = Math.ceil(totalHeight * dpr);
  const totalWidthPx = Math.ceil(viewportWidth * dpr);
  const partHeightPx = Math.min(CONFIG.maxCanvasHeightPx, totalHeightPx);
  const partCount = Math.ceil(totalHeightPx / partHeightPx);

  const parts = Array.from({ length: partCount }, (_, index) => {
    const height =
      index === partCount - 1
        ? totalHeightPx - index * partHeightPx
        : partHeightPx;
    const canvas = createCanvas(totalWidthPx, height);
    return { canvas, ctx: canvas.getContext("2d") };
  });

  const scrollStep = viewportHeight - CONFIG.tileOverlapPx;
  const maxScrollY = Math.max(0, totalHeight - viewportHeight);
  let scrollY = 0;
  let tileIndex = 0;

  while (scrollY <= maxScrollY) {
    setStatus(`Capturing section ${tileIndex + 1}…`);
    await sendToContent(tabId, { type: "SCROLL_TO", scrollY });
    await new Promise((resolve) => setTimeout(resolve, CONFIG.scrollDelayMs));

    const dataUrl = await captureVisible(tab.windowId);
    const bitmap = await dataUrlToBitmap(dataUrl);

    const tileTopPx = Math.floor(scrollY * dpr);
    const tileHeightPx = bitmap.height;
    drawTile(parts, bitmap, tileTopPx, tileHeightPx, partHeightPx);

    scrollY += scrollStep;
    tileIndex += 1;

    if (scrollY > maxScrollY && scrollY - scrollStep < maxScrollY) {
      scrollY = maxScrollY;
    }
  }

  await sendToContent(tabId, { type: "SCROLL_TO", scrollY: 0 });

  if (hideFixedCheckbox.checked) {
    await sendToContent(tabId, { type: "RESTORE_FIXED" });
  }

  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");

  for (let i = 0; i < parts.length; i += 1) {
    setStatus(`Saving PNG ${i + 1} of ${parts.length}…`);
    const filename =
      parts.length === 1
        ? `full-page-${timestamp}.png`
        : `full-page-${timestamp}-part-${i + 1}.png`;
    const dataUrl = parts[i].canvas.toDataURL("image/png");
    await downloadPng(dataUrl, filename);
  }

  setStatus("Capture complete.");
  captureButton.disabled = false;
};

captureButton.addEventListener("click", () => {
  runCapture().catch((error) => {
    console.error(error);
    setStatus(`Error: ${error.message}`);
    captureButton.disabled = false;
  });
});
