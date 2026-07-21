/* Late-bound render hooks. Keeps smartfill/export from importing the renderer
   directly, which would close an import cycle through the UI modules. */
export const hooks = {
  render: () => { },
  refreshSession: () => { },
  toast: () => { }
};
