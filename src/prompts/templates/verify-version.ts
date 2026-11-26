import { userPrompt, type PhotoshopPromptTemplate } from '../_shared.js';

export const verifyVersionTemplate: PhotoshopPromptTemplate = {
  name: 'ps.verify_version',
  description:
    'Save a version and compare its full-resolution visible pixels against the previous successful version. Produces a layered PSD copy, lossless PNG, preview, comparison sheet, difference heatmap and report.',
  arguments: [
    {
      name: 'series',
      description: 'Optional stable series name for comparing edits or duplicated documents.',
      required: false,
    },
  ],
  handler: (args) =>
    userPrompt(
      'Save and verify the current artwork version',
      [
        '1. Call photoshop_get_state and capture document.id.',
        '2. Call photoshop_recipe_verify_version with document_id' +
          (args.series
            ? ' and series=' + JSON.stringify(args.series)
            : '; reuse the same series when comparing duplicated documents') +
          '.',
        '3. Inspect the returned image and comparison metrics. First run establishes a baseline; changed dimensions are reported separately.',
        'The workflow already saved its artifacts. Source path, dirty state, layers and history are unchanged. Do not call save_document or get_preview again unless further edits are required.',
      ].join('\n')
    ),
};
