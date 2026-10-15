// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`), run when a scene reaches them.
// The fields arrive resolved (variables substituted, defaults applied); the
// result is returned as the declared outputs. Throwing fails this action only.
//
//   - lock             : always available, it can only secure the door;
//   - unlock           : refused unless "Allow unlocking" is on in the
//                        configuration — the only way Gladys opens a lock;
//   - set_passage_mode : refused unless "Allow passage mode" is on.
//
// No scene trigger is ever fired from here (no loops).
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  /** @param {import('./hub.js').Hub} hub */
  lock: async (hub, fields) => ({ locked: await hub.lock(fields.device, 'scene') }),

  unlock: async (hub, fields) => ({ unlocked: await hub.unlock(fields.device) }),

  set_passage_mode: async (hub, fields) => ({
    passage_mode: await hub.setPassageMode(fields.device, fields.enabled === true),
  }),
};
