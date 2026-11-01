// Right-click a selection -> open the check panel with that text. Nothing is ever sent on the user's behalf.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "tradedesk-check", title: "TradeDesk 发出前检查", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "tradedesk-check" || !info.selectionText) return;
  await chrome.storage.session.set({ pending: info.selectionText });
  chrome.windows.create({ url: "panel.html?from=menu", type: "popup", width: 460, height: 720 });
});
