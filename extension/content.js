let hiddenElements = [];

const getScrollableHeight = () =>
  Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight,
    document.body.offsetHeight,
    document.documentElement.offsetHeight,
    document.body.clientHeight,
    document.documentElement.clientHeight
  );

const getViewportSize = () => ({
  width: window.innerWidth,
  height: window.innerHeight
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scrollToBottomUntilStable = async ({ step, delay, settleRounds, maxRounds }) => {
  let stableRounds = 0;
  let previousHeight = 0;
  let rounds = 0;

  while (stableRounds < settleRounds && rounds < maxRounds) {
    const totalHeight = getScrollableHeight();
    const viewportHeight = getViewportSize().height;
    const maxScrollY = Math.max(0, totalHeight - viewportHeight);
    const currentY = Math.min(window.scrollY + step, maxScrollY);

    window.scrollTo(0, currentY);
    await sleep(delay);

    const newHeight = getScrollableHeight();
    if (currentY >= maxScrollY && newHeight === previousHeight) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }

    previousHeight = newHeight;
    rounds += 1;
  }

  return { totalHeight: getScrollableHeight(), stableRounds, rounds };
};

const hideFixedAndSticky = () => {
  hiddenElements = [];
  const elements = Array.from(document.querySelectorAll("*"));
  for (const el of elements) {
    const style = window.getComputedStyle(el);
    if (style.position === "fixed" || style.position === "sticky") {
      const previousVisibility = el.style.visibility;
      el.style.visibility = "hidden";
      hiddenElements.push({ el, previousVisibility });
    }
  }
};

const restoreFixedAndSticky = () => {
  for (const { el, previousVisibility } of hiddenElements) {
    el.style.visibility = previousVisibility;
  }
  hiddenElements = [];
};

const warmUpLazyLoad = async (step, delay) => {
  const totalHeight = getScrollableHeight();
  const viewportHeight = getViewportSize().height;
  const maxScrollY = totalHeight - viewportHeight;
  let currentY = 0;

  while (currentY < maxScrollY) {
    window.scrollTo(0, currentY);
    await sleep(delay);
    currentY += step;
  }

  window.scrollTo(0, maxScrollY);
  await sleep(delay);
  window.scrollTo(0, 0);
  await sleep(delay);
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_PAGE_METRICS") {
    sendResponse({
      totalHeight: getScrollableHeight(),
      viewport: getViewportSize(),
      devicePixelRatio: window.devicePixelRatio
    });
    return true;
  }

  if (message?.type === "SCROLL_TO") {
    window.scrollTo(0, message.scrollY || 0);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "HIDE_FIXED") {
    hideFixedAndSticky();
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "RESTORE_FIXED") {
    restoreFixedAndSticky();
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "WARMUP_LAZY") {
    warmUpLazyLoad(message.step, message.delay)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "AUTO_EXPAND") {
    scrollToBottomUntilStable(message.options)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
