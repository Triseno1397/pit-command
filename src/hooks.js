/* Late-bound render hooks. Keeps smartfill/export from importing the renderer
   directly, which would close an import cycle through the UI modules. */
export const hooks = {
  render: () => { },
  refreshSession: () => { },
  toast: () => { },
  /* Fired by queueSave() on every edit. Crew sync listens here rather than at
     each mutation site, so a site added later cannot forget to report itself. */
  changed: () => { }
};
