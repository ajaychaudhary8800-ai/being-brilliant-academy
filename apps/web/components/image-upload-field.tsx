/* eslint-disable @next/next/no-img-element */
"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { ImagePlus, Trash2, Upload } from "lucide-react";

export const maximumImageBytes = 5 * 1024 * 1024;
const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const imageExtension = /\.(?:jpe?g|png|webp)$/i;

export function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read the selected image"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

type Props = {
  label: string;
  currentUrl: string | null;
  selectedFile: File | null;
  disabled?: boolean;
  onFileChange: (file: File | null) => void;
  onRemove: () => void;
  onError: (message: string) => void;
  error?: string;
};

export default function ImageUploadField({ label, currentUrl, selectedFile, disabled = false, onFileChange, onRemove, onError, error }: Props) {
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [inputKey, setInputKey] = useState(0);

  useEffect(() => {
    if (!selectedFile) { setPreview(currentUrl); return; }
    const objectUrl = URL.createObjectURL(selectedFile);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [currentUrl, selectedFile]);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!imageTypes.includes(file.type) || !imageExtension.test(file.name)) {
      onFileChange(null); onError("Choose a JPG, JPEG, PNG or WEBP image."); event.target.value = ""; return;
    }
    if (!file.size) { onFileChange(null); onError("The selected image is empty."); event.target.value = ""; return; }
    if (file.size > maximumImageBytes) { onFileChange(null); onError("Image size must not exceed 5 MB."); event.target.value = ""; return; }
    onError(""); onFileChange(file);
  }

  function remove() {
    onFileChange(null); onError(""); onRemove(); setInputKey(value => value + 1);
  }

  return <div className="sm:col-span-2"><span className="block text-sm font-semibold">{label}</span><div className="mt-2 flex flex-col gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700 sm:flex-row sm:items-center"><div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800">{preview ? <img src={preview} alt={`${label} preview`} className="h-full w-full object-cover" /> : <ImagePlus size={30} />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2"><label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white ${disabled ? "pointer-events-none opacity-50" : ""}`}><Upload size={16} />{preview ? "Replace Image" : "Choose Image"}<input key={inputKey} disabled={disabled} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={choose} className="sr-only" /></label>{preview && <button disabled={disabled} type="button" onClick={remove} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-50"><Trash2 size={16} />Remove</button>}</div>{selectedFile && <p className="mt-2 truncate text-sm text-slate-600 dark:text-slate-300">{selectedFile.name}</p>}<p className="mt-1 text-xs text-slate-500">JPG, JPEG, PNG or WEBP. Maximum 5 MB.</p>{error && <p role="alert" className="mt-2 text-sm font-medium text-red-600">{error}</p>}</div></div></div>;
}
