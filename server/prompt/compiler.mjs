function cleanTemplate(value) {
  return String(value || "")
    .replace(/\b(ignore|disregard)\s+(all|any|previous)\s+instructions?\b/gi, "")
    .replace(/\b(?:api[_ -]?key|access[_ -]?token|password|secret)\b[^\n]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function capTemplate(template, available) {
  if (available <= 0) return "";
  if (template.length <= available) return template;
  const cut = template.slice(0, available);
  const boundary = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("\n"), cut.lastIndexOf(","));
  return cut.slice(0, boundary > available * 0.55 ? boundary : available).trim();
}

export function compileTemplatePrompt({ userPrompt, template, maxPromptLength = 100_000 } = {}) {
  const user = String(userPrompt || "");
  if (!template) return { prompt: user, usedTemplate: false, truncatedTemplate: false, warnings: ["PROMPT_TEMPLATE_UNAVAILABLE"] };
  const clean = cleanTemplate(template.prompt || template.content);
  const prefix = "User intent (authoritative; preserve literal text and requested subjects):\n";
  const suffix = "\n\nVisual template guidance (adapt style, composition and lighting only; replace conflicting subjects or text):\n";
  const ending = "\n\nCreate exactly one image.";
  const remaining = maxPromptLength - prefix.length - user.length - suffix.length - ending.length;
  const templateText = capTemplate(clean, remaining);
  const prompt = `${prefix}${user}${suffix}${templateText}${ending}`;
  const warnings = [];
  if (templateText.length < clean.length) warnings.push("PROMPT_TEMPLATE_CONTEXT_TRUNCATED");
  return { prompt, usedTemplate: true, truncatedTemplate: templateText.length < clean.length, warnings };
}

export function fitEnhancedPrompt({ userPrompt, enhancedPrompt, template, maxPromptLength = 100_000 } = {}) {
  const enhanced = String(enhancedPrompt || "").trim();
  if (enhanced && enhanced.length <= maxPromptLength) return { prompt: enhanced, warnings: [] };
  const fallback = compileTemplatePrompt({ userPrompt, template, maxPromptLength });
  return {
    prompt: fallback.prompt,
    warnings: ["ENHANCED_PROMPT_EXCEEDED_PROVIDER_LIMIT", ...fallback.warnings],
  };
}
