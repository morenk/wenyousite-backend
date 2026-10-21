export function fontVersionState(
  published: boolean,
  enabled: boolean,
  current: boolean,
  withdrawn: boolean,
) {
  return {
    selectable: published && enabled && current && !withdrawn,
    pasteAllowed: published && enabled && !withdrawn,
    renderAllowed: published && !withdrawn,
  };
}
