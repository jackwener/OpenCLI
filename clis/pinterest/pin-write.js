// Shared logic for the Pinterest pin write commands (pin-update / pin-update-batch, save /
// save-batch): validate the flags, resolve the target board and section once, then act per pin.
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
  PINTEREST_BASE,
  movePinToSection,
  pinterestResourceCreate,
  pinterestResourceUpdate,
  resolveBoardId,
  resolveBoardTarget,
  resolveSection,
} from './utils.js';

const optionalText = (value) => (value === undefined || value === null ? undefined : String(value).trim());

/** Validate the pin-update field flags; returns { fields, boardRef, section }. */
export function readPinUpdateInput(kwargs) {
  const fields = {};
  const title = optionalText(kwargs.title);
  const description = optionalText(kwargs.description);
  const altText = optionalText(kwargs['alt-text']);
  if (title !== undefined) fields.title = title;
  if (description !== undefined) fields.description = description;
  if (altText !== undefined) fields.alt_text = altText;

  const boardRef = String(kwargs.board ?? '').trim();
  const section = optionalText(kwargs.section);

  if (Object.keys(fields).length === 0 && !boardRef) {
    // --section alone falls through to the more specific error below.
    if (section === undefined) {
      throw new ArgumentError(
        'nothing to update',
        'Pass at least one of --title, --description, --alt-text, or --board',
      );
    }
  }
  if (section !== undefined && !boardRef) {
    throw new ArgumentError('--section requires --board', 'Sections belong to a board, so pass --board too');
  }
  return { fields, boardRef, section: section || '' };
}

/**
 * Do the work shared by every pin of a call: navigate, and resolve the target board / section.
 * Returns { options, sourceUrl }; sourceUrl is null when each pin should use its own page.
 */
export async function preparePinUpdate(page, { fields, boardRef, section }, firstPinId) {
  const options = { ...fields };
  if (!boardRef) {
    await page.goto(`${PINTEREST_BASE}/pin/${firstPinId}/`);
    return { options, sourceUrl: null };
  }
  const { username, slug, path, board: preloadedBoard } = await resolveBoardTarget(page, boardRef);
  await page.goto(`${PINTEREST_BASE}${path}`);
  const { boardId } = await resolveBoardId(page, username, slug, path, preloadedBoard);
  options.board_id = boardId;
  // PinResource/update is the only endpoint that honours a section, and only under this key.
  // Without it a board_id update files the pin on the board root, even when the pin was already
  // in a section of that same board — which is how a pin leaves a section.
  if (section) options.board_section_id = (await resolveSection(page, boardId, section, path)).sectionId;
  return { options, sourceUrl: path };
}

/** Apply a prepared update to one pin; returns the updated pin. */
export async function applyPinUpdate(page, id, { options, sourceUrl }) {
  const updated = await pinterestResourceUpdate(page, 'PinResource', { id, ...options }, sourceUrl || `/pin/${id}/`);
  if (!updated || !updated.id) {
    throw new CommandExecutionError('Pin update did not return the updated pin');
  }
  return updated;
}

/**
 * Validate the destination and resolve it once: navigates, and looks up the board / section.
 * Returns { boardRef, boardId, sectionId, sourceUrl }; boardId is '' for a profile save.
 */
export async function prepareSaveTarget(page, kwargs) {
  const boardRef = String(kwargs.board ?? '').trim();
  const section = String(kwargs.section ?? '').trim();
  if (section && !boardRef) {
    throw new ArgumentError('--section requires --board', 'Sections belong to a board, so pass --board too');
  }
  if (!boardRef) {
    // No board given: Pinterest routes a boardless repin to the profile's Quick Saves board.
    await page.goto(`${PINTEREST_BASE}/`);
    return { boardRef, boardId: '', sectionId: '', sourceUrl: '/' };
  }
  const { username, slug, path, board } = await resolveBoardTarget(page, boardRef);
  await page.goto(`${PINTEREST_BASE}${path}`);
  const { boardId } = await resolveBoardId(page, username, slug, path, board);
  // Validate --section before repinning, so a bad value fails before anything is created.
  const sectionId = section ? (await resolveSection(page, boardId, section, path)).sectionId : '';
  return { boardRef, boardId, sectionId, sourceUrl: path };
}

/** Repin one pin to a prepared target; returns the save row. */
export async function savePin(page, sourcePinId, { boardRef, boardId, sectionId, sourceUrl }) {
  const options = { pin_id: sourcePinId };
  if (boardId) options.board_id = boardId;

  const created = await pinterestResourceCreate(page, 'RepinResource', options, sourceUrl);
  const newId = created && created.id;
  if (!newId) {
    throw new CommandExecutionError('Repin did not return a pin id');
  }

  if (sectionId) {
    await movePinToSection(page, newId, boardId, sectionId, sourceUrl);
  }

  return {
    pinId: String(newId),
    sourcePinId,
    board: (created.board && created.board.name) || (boardRef || 'profile'),
    url: `${PINTEREST_BASE}/pin/${newId}/`,
  };
}
