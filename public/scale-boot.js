// Applies the panel's Size setting before the first paint. A classic script
// in the panel's <head>, so the parser runs it before anything is drawn;
// the panel's module bundle is deferred and can land a frame late, which
// shows the panel at 100% for an instant and then jumps. src/panel/scale.ts
// keeps the value here (localStorage "intel.panel.scale", a mirror of the
// settings table) and takes over once it runs. Plain JavaScript, served from
// public/, because a module script cannot block rendering.
(function () {
    try {
        var percent = Number(localStorage.getItem("intel.panel.scale"));
        if (percent >= 50 && percent <= 200) document.documentElement.style.setProperty("--ui-scale", String(percent / 100));
    } catch (error) {
        // No storage: the panel is drawn at 100% and corrected from the table.
    }
})();
