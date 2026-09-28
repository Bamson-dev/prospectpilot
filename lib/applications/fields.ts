export type FieldHint = {
  label?: string | null;
  name?: string | null;
  placeholder?: string | null;
  ariaLabel?: string | null;
  nearby?: string | null;
  type?: string | null;
};

const MAP: Array<{ key: string; patterns: RegExp }> = [
  { key: "firstName", patterns: /first[_\s-]?name|given[_\s-]?name/i },
  { key: "lastName", patterns: /last[_\s-]?name|family[_\s-]?name|surname/i },
  { key: "fullName", patterns: /full[_\s-]?name|^name$/i },
  { key: "email", patterns: /e-?mail/i },
  { key: "phone", patterns: /phone|mobile|tel/i },
  { key: "location", patterns: /city|location|address/i },
  { key: "resume", patterns: /resume|cv|curriculum/i },
  { key: "coverLetter", patterns: /cover[_\s-]?letter/i },
];

export function mapField(hint: FieldHint) {
  const text = [hint.label, hint.name, hint.placeholder, hint.ariaLabel, hint.nearby, hint.type].filter(Boolean).join(" ");
  const match = MAP.find((item) => item.patterns.test(text));
  return match?.key ?? null;
}

export function unknownRequiredFields(hints: FieldHint[]) {
  return hints.filter((hint) => /required/i.test(`${hint.label ?? ""} ${hint.nearby ?? ""}`) && mapField(hint) === null);
}
