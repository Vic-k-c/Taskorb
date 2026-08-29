// Each template just seeds a starting set of lists. Everything stays fully
// editable afterward -- this is a starting point, not a locked structure.
// `icon` is inline SVG (currentColor stroke) rendered unescaped in views.
// Blank listed first (see TEMPLATES below) since it's the sensible default.
const ICONS = {
  blank: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3.5" width="18" height="17" rx="2.5"/><path d="M7 8.5h10" stroke-dasharray="1.6 2.2"/><path d="M7 12h7" stroke-dasharray="1.6 2.2"/><path d="M7 15.5h4" stroke-dasharray="1.6 2.2"/><path d="M16.5 15.5v4M14.5 17.5h4" stroke-width="1.6"/></svg>`,
  soul_winning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.2s-7-4.3-9.4-8.7C1.1 8 2.6 4.8 5.8 4.8c1.9 0 3.3 1 4 2.2.1.2.4.2.5 0 .7-1.2 2.1-2.2 4-2.2 3.2 0 4.7 3.2 3.2 6.7-2.4 4.4-9.4 8.7-9.4 8.7z"/><path d="M8.3 12l2.2 2.2 4.7-4.7"/><path d="M4.5 2.8l.9 1.3M19.5 2.8l-.9 1.3" stroke-width="1.4"/></svg>`,
`,
  marketing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18" stroke-width="1.6"/><path d="M6 16l4.5-5 3.5 3 6-7"/><path d="M16.5 6.5H20V10" stroke-width="1.6"/></svg>`,
  online_classes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.5L12 4l10 4.5-10 4.5-10-4.5z"/><path d="M6.5 10.7v4.3c0 1.6 2.6 3 5.5 3s5.5-1.4 5.5-3v-4.3"/><path d="M21 8.5v5.5" stroke-width="1.6"/><circle cx="21" cy="15.3" r="1" fill="currentColor" stroke="none"/><path d="M10.8 16.3v2.6l2.3-1.3z" fill="currentColor" stroke="none"/></svg>`,
  todo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="6" height="6" rx="1.3"/><path d="M5.3 7l1.3 1.3L8.5 6" stroke-width="1.6"/><path d="M12 7h8.5" stroke-width="1.6"/><rect x="3.5" y="14" width="6" height="6" rx="1.3" stroke-dasharray="1.4 1.8"/><path d="M12 17h8.5" stroke-width="1.6"/></svg>`
};

const TEMPLATES = {
  blank: {
    label: 'Blank Board',
    icon: ICONS.blank,
    lists: ['To Do', 'Doing', 'Done']
  },
  soul_winning: {
    label: 'Soul Winning',
    icon: ICONS.soul_winning,
    lists: ['New Prospect', 'Contacted', 'Follow-Up', 'Bible Study', 'Decision Made', 'Not Interested']
  },
  marketing: {
    label: 'Marketing Pipeline',
    icon: ICONS.marketing,
    lists: ['Leads', 'Contacted', 'Proposal Sent', 'Negotiation', 'Won', 'Lost']
  },
  online_classes: {
    label: 'Online Classes',
    icon: ICONS.online_classes,
    lists: ['Enrolled', 'Onboarding', 'In Progress', 'Needs Follow-up', 'Completed', 'Dropped']
  },
  todo: {
    label: 'Simple To-Do',
    icon: ICONS.todo,
    lists: ['To Do', 'In Progress', 'Done']
  }
};

function getTemplate(key) {
  return TEMPLATES[key] || TEMPLATES.blank;
}

module.exports = { TEMPLATES, getTemplate };
