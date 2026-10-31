// The photos tab: a gallery of what people shared, a viewer, and uploads.

import { pictures } from "../../api/client.js";
import type { Photo } from "../../api/types.js";
import { choosePictures, pictureProblem } from "../../components/picture_picker.js";
import { h, mount } from "../../dom.js";
import { count, relativeTime } from "../../format.js";
import { icon } from "../../icons.js";
import { actionButton } from "../../ui/controls.js";
import { emptyState, errorMessage, toast } from "../../ui/feedback.js";
import { openModal } from "../../ui/modal.js";
import { avatar, pictureUrl } from "../../ui/pictures.js";
import type { EventScreen, TabView } from "./screen.js";

function photoLabel(photo: Photo): string {
  return photo.caption || `Photo by ${photo.uploader_name}`;
}

/** The photo viewer: one photo at a time, with previous and next. */
class PhotoViewer {
  private readonly holder = h("div", { class: "stack" });

  constructor(private readonly screen: EventScreen, private index: number, private readonly close: () => void) {
    this.draw();
  }

  get element(): HTMLElement {
    return this.holder;
  }

  private step(by: -1 | 1): void {
    this.index += by;
    this.draw();
  }

  private navButton(side: "left" | "right"): HTMLElement | null {
    const photos = this.screen.detail.photos;
    const back = side === "left";
    const available = back ? this.index > 0 : this.index < photos.length - 1;
    if (!available) return null;

    return h("button", { type: "button", class: `btn btn-overlay btn-icon lightbox-nav lightbox-${side}`, "aria-label": back ? "Previous" : "Next", onclick: () => this.step(back ? -1 : 1) }, icon(back ? "chevronLeft" : "chevronRight"));
  }

  private deleteButton(photo: Photo): HTMLElement | null {
    const mayDelete = photo.uploader_id === this.screen.me.id || this.screen.detail.can_manage;
    if (!mayDelete) return null;

    return actionButton([icon("trash", "sm"), "Delete"], async () => {
      const remaining = await pictures.removePhoto(photo.id);
      toast("Photo deleted");
      this.close();
      this.screen.update((detail) => {
        detail.photos = remaining;
      });
    }, { class: "btn btn-sm btn-danger" });
  }

  private draw(): void {
    const photo = this.screen.detail.photos[this.index];
    if (!photo) return;

    const stage = h("div", { class: "lightbox" }, h("img", { src: pictureUrl(photo.id), alt: photoLabel(photo) }), this.navButton("left"), this.navButton("right"));
    const who = h("div", { class: "row" },
      avatar({ name: photo.uploader_name, avatar: photo.uploader_avatar }, 30),
      h("div", {}, h("div", { class: "strong small" }, photo.uploader_name), h("div", { class: "tiny muted" }, relativeTime(photo.created_at))));
    const actions = h("div", { class: "row" },
      h("a", { class: "btn btn-sm", href: pictureUrl(photo.id), download: `photo-${photo.id.slice(0, 8)}.jpg` }, icon("download", "sm"), "Download"),
      this.deleteButton(photo));

    mount(this.holder, stage, h("div", { class: "row-between" }, who, actions), photo.caption ? h("p", { class: "text-2" }, photo.caption) : null);
  }
}

function openPhoto(screen: EventScreen, index: number): void {
  void openModal<void>({ title: "Photo", wide: true, build: (close) => new PhotoViewer(screen, index, () => close()).element });
}

/** Uploads the chosen files one by one, reporting each failure. */
async function upload(screen: EventScreen, files: File[], progress: HTMLElement): Promise<void> {
  let added = 0;
  progress.hidden = false;

  for (const [index, file] of files.entries()) {
    mount(progress, h("span", { class: "spinner" }), `Uploading ${index + 1} of ${files.length}…`);
    try {
      const problem = pictureProblem(file);
      if (problem) throw new Error(problem);
      screen.detail.photos = await pictures.addPhoto(screen.detail.event.id, file);
      added += 1;
    } catch (error) {
      toast(`${file.name}: ${errorMessage(error)}`, "error");
    }
  }

  if (added) toast(`Added ${count(added, "photo")}`, "success");
  screen.update(() => undefined);
}

function addButton(screen: EventScreen, progress: HTMLElement): HTMLElement | null {
  if (!screen.detail.is_member) return null;

  return actionButton([icon("upload"), "Add photos"], async () => {
    const files = await choosePictures(true);
    if (files.length) await upload(screen, files, progress);
  }, { class: "btn btn-primary" });
}

function gallery(screen: EventScreen): HTMLElement {
  const { photos, is_member: isMember } = screen.detail;
  if (!photos.length) {
    return emptyState("camera", "No photos yet", isMember ? "Share photos from the outing so everyone has them." : "Members of the tribe can share photos here.");
  }

  const tiles = photos.map((photo, index) =>
    h("button", { type: "button", "aria-label": photoLabel(photo), onclick: () => openPhoto(screen, index) }, h("img", { src: pictureUrl(photo.id, "small"), alt: "", loading: "lazy" })));
  return h("div", { class: "gallery" }, tiles);
}

/** The photos tab. */
export function photosTab(screen: EventScreen): TabView {
  const progress = h("div", { class: "upload-progress", hidden: true });
  const head = h("div", { class: "card-head" },
    h("div", {}, h("h3", {}, "Photos"), h("p", { class: "small muted card-sub" }, "Shared by people in the tribe. Location data is removed from every upload.")),
    addButton(screen, progress));

  return { element: h("section", { class: "card tab-body" }, head, h("div", { class: "card-body stack" }, progress, gallery(screen))) };
}
