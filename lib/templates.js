// Each template just seeds a starting set of lists. Everything stays fully
// editable afterward -- this is a starting point, not a locked structure.
// `icon` is inline SVG (currentColor stroke) rendered unescaped in views.
const ICONS = {
  soul_winning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2 5 5.4 5c2 0 3.4 1.1 4.1 2.3.2.3.7.3.9 0C11.2 6.1 12.6 5 14.6 5 18 5 19.6 8.4 22 11.7 19.5 16.4 12 21 12 21z"/><path d="M8 12l2 2 5-5"/></svg>`,
  marketing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 6h6v6"/><path d="M3 21h18"/></svg>`,
  online_classes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l10-5 10 5-10 5-10-5z"/><path d="M6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5"/><path d="M22 8v7"/></svg>`,
  todo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>`,
  blank: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>`
};

const TEMPLATES = {
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
  },
  blank: {
    label: 'Blank Board',
    icon: ICONS.blank,
    lists: ['To Do', 'Doing', 'Done']
  }
};

function getTemplate(key) {
  return TEMPLATES[key] || TEMPLATES.blank;
}

module.exports = { TEMPLATES, getTemplate };
