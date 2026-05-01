# Tab Subgroups Extension

Organize your browser by nesting tab groups inside each other. Create powerful hierarchies to keep your workspace clean and navigable. To try this extension yourself, click [here](https://chromewebstore.google.com/detail/moregroups-subgroup-your/djbmocfpfgbhcglagcibhagfnehcbkfc)

## Features

- **Nested Grouping:** Create subgroups by moving tabs from one group into another.
- **Recursive Collapse:** When you collapse a parent group, all its child subgroups are automatically saved and removed from the browser to save space.
- **Recursive Expand:** When you un-collapse a parent, its direct children are restored in a neat, collapsed state.
- **Color Inheritance:** Subgroups automatically match the color of their highest-level ancestor ("root parent").
- **Smart Priority:** When creating a group from multiple tabs, the leftmost tab that already belongs to a group determines the parent.
- **Naming Control:**
  - Subgroups are automatically named `Parent-N`.
  - Rename a subgroup normally, and the extension will remember it.
  - Type `$b` as a title to revert the name back to the automatic `Parent-N` format.

## How to Use

1.  **Create a Parent Group:** Right-click a tab and select "Add tab to new group". Give it a name (e.g., "Work").
2.  **Create a Subgroup:** Drag a tab that is already in "Work" and create a *new* group with it. The new group will automatically be named "Work-1" and become a child of "Work".
3.  **Manage Hierarchies:** 
    - Click the "Work" group header to collapse it. All "Work-1", "Work-2", etc., tabs will disappear.
    - Click again to expand. The subgroups will reappear as small, collapsed headers.
4.  **Deep Nesting:** You can repeat this process (e.g., creating a subgroup from "Work-1") to create N-levels of organization.

## Technical Details

- **Privacy:** All tab data (URLs and titles) is stored locally on your machine using `chrome.storage.local`. No data ever leaves your browser.
- **Efficiency:** The extension uses persistent ID mapping rather than title parsing, ensuring it never loses track of your groups even if you rename them.

## Permissions

- `tabGroups`: Used to create and organize groups.
- `tabs`: Used to save and restore tab URLs.
- `storage`: Used to persist your group hierarchies across browser restarts.

## Privacy Policy

## Intro

This privacy policy contains the how this extension (the MoreGroups extension) collects and handles personal data.

## Data Collection

This extension does not collect any data. Therefore, no data will be or can be sold to third parties. With this being said, there is one way your data is used.

## Chrome Storage API

This extension uses [Google Chrome's Storage API](https://developers.chrome.com/extensions/storage) to locally store group titles, group ids, group colors, and tab URLs. However, this extension does not transmit any of this information and only accesses it locally on your machine.

## Changes to the Privacy Policy

If there are any major changes made to this privacy policy, I will push a new version and ask you to agree to the changed privacy policy.

## Feedback

If you happen to have any questions or concerns, feel free to [send me an email](mailto:garrettrussell111@gmail.com) or create an issue in this repository.

***

#### Note
By major, I mean that users will not be notified for changes to fix grammar, typos, or other errors of a similar magnitude.
