function convertHtml2JsonAndSet() {
  const jsonArea = document.getElementById("json");
  const message = document.getElementById("conversion-message");

  try {
    const htmlText = document.getElementById("html").value;
    const result = html2json(htmlText);
    jsonArea.textContent = JSON.stringify(result, null, 2);

    if (result.status === "failure") {
      message.textContent = "Conversion failed: " + result.errors[0].message;
      return;
    }

    if (result.status === "recovered") {
      message.textContent = "Converted with recovery. Markup or incomplete markup was recognized. Review the diagnostics in the JSON output.";
      return;
    }

    const messages = {
      empty: "Converted successfully. The input is empty.",
      whitespace: "Converted successfully. The input contains only whitespace.",
      text: "Converted successfully as text. No HTML markup was recognized.",
      markup: "Converted successfully. Markup was recognized."
    };

    message.textContent = messages[result.contentType];
  } catch (error) {
    console.error("Unexpected error in convertHtml2JsonAndSet:", error);
    jsonArea.textContent = "";
    message.textContent = "An unexpected error occurred. Please try again.";
  }
}

function clearConversionMessage() {
  document.getElementById("conversion-message").textContent = "";
}

// A source-oriented HTML scanner, not an implementation of browser tree repair.
function html2json(htmlText) {
  const MAX_DEPTH = 256;
  const MAX_ERRORS = 100;

  function failure(code, message, position) {
    return {
      status: "failure",
      contentType: "unknown",
      children: [],
      errors: [{ code, position, message }],
      suppressedErrors: 0
    };
  }

  if (typeof htmlText !== "string") {
    return failure("INVALID_INPUT", "Expected an HTML string.", -1);
  }

  const result = {
    status: "success",
    contentType: "unknown",
    children: [],
    errors: [],
    suppressedErrors: 0
  };
  const stack = [{ node: result, foreign: false }];

  const voidNames = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
    "param", "source", "track", "wbr"
  ]);
  const paragraphClosingStartTags = new Set([
    "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl",
    "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4",
    "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "p", "pre",
    "search", "section", "table", "ul"
  ]);
  const paragraphBoundaries = new Set(["html", "table", "td", "th", "caption", "select", "button"]);
  const listItemNames = new Set(["li"]);
  const listBoundaries = new Set(["ul", "ol", "menu", "table", "select"]);
  const definitionItemNames = new Set(["dt", "dd"]);
  const definitionBoundaries = new Set(["dl", "table", "select"]);
  const optionNames = new Set(["option"]);
  const optionBoundaries = new Set(["select", "datalist", "optgroup"]);
  const optionGroupNames = new Set(["optgroup"]);
  const selectBoundaries = new Set(["select"]);
  const paragraphNames = new Set(["p"]);

  let position = 0;
  let recognizedMarkup = false;

  // HTML names fold ASCII letters only; Unicode lowercasing would change more.
  const asciiLowerCase = value => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
  const isHtmlWhitespace = character => character !== undefined && /[\t\n\f\r ]/.test(character);
  const currentEntry = () => stack[stack.length - 1];

  function reportDiagnostic(code, sourcePosition, message) {
    result.status = "recovered";

    if (result.errors.length < MAX_ERRORS) {
      result.errors.push({ code, position: sourcePosition, message });
    } else {
      result.suppressedErrors++;
    }
  }

  function appendText(value) {
    if (!value) return;

    const children = currentEntry().node.children;
    const previous = children[children.length - 1];

    if (previous && previous.type === "text") {
      previous.value += value;
    } else {
      children.push({ type: "text", value });
    }
  }

  // Search only within the relevant HTML scope; never cross foreign content.
  function findOpenElementInScope(names, boundaries) {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i].foreign) return -1;
      if (names.has(stack[i].node.tagName)) return i;
      if (boundaries.has(stack[i].node.tagName)) return -1;
    }

    return -1;
  }

  function canOmitEndTag(entry, parent, grandparent) {
    if (entry.foreign) return false;

    const name = entry.node.tagName;
    const parentName = parent.node.tagName;

    if (name === "li") return /^(ul|ol|menu)$/.test(parentName);

    // Only a div directly under dl qualifies as a definition-list group.
    if (name === "dd" && parentName === "div") {
      return !!grandparent && !grandparent.foreign && grandparent.node.tagName === "dl";
    }

    if (name === "dd") return parentName === "dl";
    if (name === "option") return /^(select|optgroup|datalist)$/.test(parentName);
    if (name === "optgroup") return parentName === "select";

    const isCustomParent =
      typeof parentName === "string" && parentName.includes("-");

    return (name === "p" && !isCustomParent && !/^(a|audio|del|ins|map|noscript|video)$/.test(parentName));
  }

  // Pop the target index and everything above it. Explicit end tags call this
  // for intervening elements only, then pop their matched target separately.
  function closeOpenElements(firstIndexToClose, sourcePosition, allowTargetOmission = false) {
    while (stack.length > firstIndexToClose) {
      const entryIndex = stack.length - 1;
      const entry = stack[entryIndex];
      const parent = stack[entryIndex - 1];
      const grandparent = stack[entryIndex - 2];
      const isTarget = entryIndex === firstIndexToClose;

      stack.pop();

      if (isTarget && allowTargetOmission) continue;
      if (canOmitEndTag(entry, parent, grandparent)) continue;

      reportDiagnostic("UNCLOSED_TAG", sourcePosition, "Implicitly closed <" + entry.node.tagName + ">.");
    }
  }

  function closeOptionalBefore(name, sourcePosition) {
    let index = -1;

    if (name === "li") index = findOpenElementInScope(listItemNames, listBoundaries);
    if (name === "dt" || name === "dd") index = findOpenElementInScope(definitionItemNames, definitionBoundaries);
    if (name === "option" || name === "optgroup") {
      index = findOpenElementInScope(optionNames, optionBoundaries);
    }

    if (index >= 0) closeOpenElements(index, sourcePosition, true);

    if (name === "optgroup") {
      index = findOpenElementInScope(optionGroupNames, selectBoundaries);
      if (index >= 0) closeOpenElements(index, sourcePosition, true);
    }

    if (paragraphClosingStartTags.has(name)) {
      index = findOpenElementInScope(paragraphNames, paragraphBoundaries);
      if (index >= 0) closeOpenElements(index, sourcePosition, true);
    }
  }

  // Read one opening tag. Quoted values may contain '>'; unquoted '/' is data.
  function readOpeningTag(start) {
    let cursor = start + 1;
    const nameStart = cursor;

    while (cursor < htmlText.length && !/[\t\n\f\r />]/.test(htmlText[cursor])) cursor++;

    const tagName = htmlText.slice(nameStart, cursor);
    const attributes = [];

    while (cursor < htmlText.length) {
      while (isHtmlWhitespace(htmlText[cursor])) cursor++;

      if (htmlText[cursor] === ">") {
        return { tagName, attributes, end: cursor + 1, selfClosing: false };
      }

      // EOF after '/' is an incomplete self-closing marker, not an attribute.
      if (htmlText[cursor] === "/" && cursor + 1 === htmlText.length) return null;

      if (htmlText[cursor] === "/" && htmlText[cursor + 1] === ">") {
        return { tagName, attributes, end: cursor + 2, selfClosing: true };
      }

      const attributeStart = cursor;

      while (cursor < htmlText.length && !/[\t\n\f\r /=>]/.test(htmlText[cursor])) {
        cursor++;
      }

      if (cursor === attributeStart) {
        if (cursor >= htmlText.length) break;
        reportDiagnostic("INVALID_ATTRIBUTE", cursor, "Skipped an unexpected attribute character.");
        cursor++;
        continue;
      }

      const name = htmlText.slice(attributeStart, cursor);

      while (isHtmlWhitespace(htmlText[cursor])) cursor++;

      let value = null;

      if (htmlText[cursor] === "=") {
        cursor++;

        while (isHtmlWhitespace(htmlText[cursor])) cursor++;

        if (htmlText[cursor] === ">") {
          reportDiagnostic(
            "MISSING_ATTRIBUTE_VALUE",
            cursor,
            "Expected an attribute value after '='."
          );
        }

        const quote = htmlText[cursor];

        if (quote === '"' || quote === "'") {
          const valueStart = ++cursor;

          while (cursor < htmlText.length && htmlText[cursor] !== quote) {
            cursor++;
          }

          if (cursor === htmlText.length) return null;
          value = htmlText.slice(valueStart, cursor++);
        } else {
          const valueStart = cursor;

          while (cursor < htmlText.length && !isHtmlWhitespace(htmlText[cursor]) && htmlText[cursor] !== ">") {
            cursor++;
          }

          value = htmlText.slice(valueStart, cursor);
        }
      }

      attributes.push({ name, value });
    }

    return null;
  }

  while (position < htmlText.length) {
    const start = position;
    const current = currentEntry();

    if (!current.foreign && /^(script|style|textarea|title)$/.test(current.node.tagName)) {
      const endTag = new RegExp("</" + current.node.tagName + "[\\t\\n\\f\\r ]*>", "ig");
      endTag.lastIndex = position;
      const match = endTag.exec(htmlText);
      const end = match ? match.index : htmlText.length;

      appendText(htmlText.slice(position, end));
      position = match ? endTag.lastIndex : end;
      if (match) stack.pop();

      continue;
    }

    if (htmlText[position] !== "<") {
      const next = htmlText.indexOf("<", position);

      position = next < 0 ? htmlText.length : next;
      appendText(htmlText.slice(start, position));
      continue;
    }

    if (htmlText.startsWith("<!--", position)) {
      recognizedMarkup = true;
      const end = htmlText.indexOf("-->", position + 4);

      current.node.children.push({
        type: "comment",
        value: htmlText.slice(position + 4, end < 0 ? htmlText.length : end)
      });

      if (end < 0) reportDiagnostic("UNCLOSED_COMMENT", start, "Comment continues to end of input.");
      position = end < 0 ? htmlText.length : end + 3;
      continue;
    }

    // Preserve foreign CDATA as source text, without interpreting its contents.
    if (current.foreign && htmlText.startsWith("<![CDATA[", position)) {
      recognizedMarkup = true;
      const end = htmlText.indexOf("]]>", position + 9);

      position = end < 0 ? htmlText.length : end + 3;
      appendText(htmlText.slice(start, position));
      if (end < 0) reportDiagnostic("INCOMPLETE_DECLARATION", start, "Preserved incomplete declaration as text.");
      continue;
    }

    if (htmlText.startsWith("<!", position)) {
      recognizedMarkup = true;
      const isDoctype = /^<!doctype(?:[\t\n\f\r >])/i.test(htmlText.slice(position, position + 10));
      let cursor = position + 2;
      let quote = null;

      while (cursor < htmlText.length) {
        const character = htmlText[cursor];
        if (quote) {
          if (character === quote) quote = null;
        } else if (character === '"' || character === "'") {
          quote = character;
        } else if (character === ">") {
          break;
        }
        cursor++;
      }

      if (cursor === htmlText.length) {
        appendText(htmlText.slice(position));
        reportDiagnostic("INCOMPLETE_DECLARATION", start, "Preserved incomplete declaration as text.");
      } else if (isDoctype) {
        current.node.children.push({ type: "doctype", value: htmlText.slice(position + 2, cursor) });
      } else {
        appendText(htmlText.slice(position, cursor + 1));
      }

      position = Math.min(cursor + 1, htmlText.length);
      continue;
    }

    if (htmlText.startsWith("</", position)) {
      recognizedMarkup = true;
      // Stop at another '<' as well, so repeated incomplete end tags do not
      // repeatedly scan the entire remaining document.
      let end = position + 2;

      while (end < htmlText.length && htmlText[end] !== ">" && htmlText[end] !== "<") end++;

      if (htmlText[end] !== ">") {
        appendText(htmlText.slice(start, end));
        reportDiagnostic("INCOMPLETE_TAG", start, "Preserved incomplete closing tag as text.");
        position = end;
        continue;
      }

      const match = /^<\/([A-Za-z][^\t\n\f\r />]*)[\t\n\f\r ]*>$/.exec(
        htmlText.slice(position, end + 1)
      );

      if (match) {
        const htmlName = asciiLowerCase(match[1]);
        let index = stack.length - 1;

        // Each candidate keeps its own matching rule across context boundaries.
        while (index > 0) {
          const entry = stack[index];
          const closingName = entry.foreign ? match[1] : htmlName;
          if (entry.node.tagName === closingName) break;
          index--;
        }

        if (index === 0) {
          reportDiagnostic("UNMATCHED_END_TAG", start, "Ignored " + match[0] + ".");
        } else {
          closeOpenElements(index + 1, start, false);
          stack.pop();
        }

        position = end + 1;
        continue;
      }
    }

    if (/[A-Za-z]/.test(htmlText[position + 1] || "")) {
      recognizedMarkup = true;
      const token = readOpeningTag(position);

      if (!token) {
        appendText(htmlText.slice(position));
        reportDiagnostic("INCOMPLETE_TAG", start, "Preserved incomplete opening tag as text.");
        position = htmlText.length;
        continue;
      }

      const name = asciiLowerCase(token.tagName);
      if (!currentEntry().foreign) closeOptionalBefore(name, start);

      if (stack.length > MAX_DEPTH) {
        return failure("MAX_DEPTH_EXCEEDED", "Conversion stopped because nesting exceeds 256 elements.", start);
      }

      const foreign = currentEntry().foreign || name === "svg" || name === "math";

      if (!foreign) {
        for (const attribute of token.attributes) attribute.name = asciiLowerCase(attribute.name);
      }

      const node = {
        type: "element",
        tagName: foreign ? token.tagName : name,
        attributes: token.attributes,
        children: []
      };

      currentEntry().node.children.push(node);
      if (!token.selfClosing && (foreign || !voidNames.has(name))) stack.push({ node, foreign });

      position = token.end;
      continue;
    }

    appendText("<");
    position++;
  }

  closeOpenElements(1, position, false);

  if (recognizedMarkup) result.contentType = "markup";
  else if (htmlText.length === 0) result.contentType = "empty";
  else if (htmlText.trim().length === 0) result.contentType = "whitespace";
  else result.contentType = "text";

  return result;
}

function showExample1() {
  clearConversionMessage();
  const htmlExample = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport">
    <title>Sample HTML</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <h1>Welcome to My Website</h1>
    </header>
    <nav>
        <ul>
            <li><a href="#home">Home</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#contact">Contact</a></li>
        </ul>
    </nav>
    <main>
        <section id="home">
            <h2>Home Section</h2>
            <p>This is the home section of the webpage.</p>
        </section>
        <section id="about">
            <h2>About Section</h2>
            <p>This is the about section of the webpage.</p>
        </section>
    </main>
    <footer>
        <p>&copy; 2024 My Website</p>
    </footer>
    <script src="script.js"></script>
</body>
</html>
`;
  const jsonContent = {
    "Comment 1":
      "You have to think about how to take into account various html inputs so your json structure will cover them all and handle different cases.",
    "Comment 2":
      "When you make any choice in terms of selecting specific json structure for conversion - be ready to provide reasoning behind such choice.",
  };

  document.getElementById("html").value = htmlExample;
  document.getElementById("json").textContent = JSON.stringify(
    jsonContent,
    null,
    2
  );
}

function showExample2() {
  clearConversionMessage();
  const htmlExample = `<div>
<p>Hello world!</p>
  <button>Click me!</button>
  <textarea>Some very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very long string.</textarea>
</div>
`;
  const jsonContent = {
    "Comment 1":
      "You have to think about how to take into account various html inputs so your json structure will cover them all and handle different cases.",
    "Comment 2":
      "When you make any choice in terms of selecting specific json structure for conversion - be ready to provide reasoning behind such choice.",
  };

  document.getElementById("html").value = htmlExample;
  document.getElementById("json").textContent = JSON.stringify(
    jsonContent,
    null,
    2
  );
}