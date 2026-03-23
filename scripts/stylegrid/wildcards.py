"""{sg:...} wildcard resolution in prompts."""

import random
import re


def resolve_sg_wildcards(prompt, styles_by_category):
    """Replace `{sg:CATEGORY}` tokens with a random style prompt from that category map."""
    def replacer(m):
        token = m.group(1).strip().lower()
        candidates = styles_by_category.get(token)
        if not candidates:
            return m.group(0)
        style = random.choice(candidates)
        return style.get("prompt", "") or m.group(0)

    return re.sub(r"\{sg:([^}]+)\}", replacer, prompt)
