/** Browser parser contract v1. Zero runtime imports; only known bounded events. */
export function parseStdoutLine(line, ts) {
  if (typeof line !== 'string' || line.length > 8192) return [];
  try {
    const event = JSON.parse(line);
    if (event?.schemaVersion !== 'cityos.paperclip-progress.v1' || !['queued', 'running'].includes(event.state)) return [];
    return [{ kind: 'system', ts, text: `CityOS execution: ${event.state}` }];
  } catch { return []; }
}
