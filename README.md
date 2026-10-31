# HTML to JSON

A JavaScript converter that turns HTML source into a JSON tree using an iterative scanner and a stack. No DOM parsing or third-party libraries are used.

## Usage

Open `index.html` in a browser, enter HTML, and click the conversion button. The page displays formatted JSON and a result message. No installation or build step is required.

You can also call the function after loading `html2json.js`:

```js
const result = html2json('<p class="greeting">Hello</p>');
console.log(JSON.stringify(result, null, 2));
```

## Implemented

- Nested elements, text, comments, doctypes, and HTML void elements.
- Quoted, unquoted, and boolean attributes, preserving their order and duplicates.
- Common optional end-tag cases for `p`, `li`, `dt`, `dd`, `option`, and `optgroup`.
- Text handling for HTML `script`, `style`, `textarea`, and `title`.
- Basic SVG/MathML handling, including self-closing elements and literal CDATA preservation.
- Recovery diagnostics for supported malformed-input cases, including incomplete markup and missing attribute values.
- Classification of empty input, whitespace, plain text, and markup.
- Interface error handling that clears stale output, displays a message, and logs unexpected exceptions.

HTML names are normalized to ASCII lowercase; foreign names retain their spelling. Text, attribute values, and character references such as `&amp;` are preserved without decoding.

## Result format

Every result has the same fields:

| Field | Meaning |
| --- | --- |
| `status` | `success`, `recovered`, or `failure` |
| `contentType` | `empty`, `whitespace`, `text`, `markup`, or `unknown` on failure |
| `children` | Ordered nodes: element, text, comment, or doctype |
| `errors` | Diagnostics with `code`, `position`, and `message` |
| `suppressedErrors` | Count of omitted diagnostics |

Element nodes contain `type`, `tagName`, `attributes`, and `children`. Attributes use `{ name, value }`; boolean values are `null`. Other nodes contain `type` and `value`.

`success` means no diagnostics were reported, not that the input passed full HTML validation. `recovered` includes diagnostics; `failure` exposes no partial tree. Plain text is valid input.
