import { record } from './notify.mjs';
import { knock } from './knock.mjs';

export async function reportProviderUpdate(request, { result = null, error = null, deliver = knock } = {}) {
  const task = `update-${request.provider}`;
  const outcome = error
    ? `${request.provider} update failed: ${error.message}.`
    : `${request.provider} update complete (${result.before_version} -> ${result.after_version}); ` +
      `${result.entries.length} exact conversation(s) reopened.`;
  record({ task, panel: request.panel, text: `${outcome}\nRecovery manifest: ${request.manifest}` });
  return deliver(task, { panel: request.panel, line: `${outcome} The lifecycle report is ready; run fm read.` });
}
