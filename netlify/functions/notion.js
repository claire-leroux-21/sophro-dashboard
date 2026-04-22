// Netlify Function : API unique pour toutes les opérations Notion
// Endpoint: /api/notion
// Body: { action: "list" | "update" | "create" | "delete", ... }

const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID || "0d6410e0-cc44-4150-a6e8-c33350bb7773";
const DATABASE_ID = process.env.NOTION_DATABASE_ID || "ae4e9cff-a719-4665-9134-fbd1110bf77e";

// ===== Mappings Notion <-> Dashboard =====

const STATUS_NOTION_TO_DASH = { "Not started": "À faire", "In progress": "En cours", "Done": "Fait" };
const STATUS_DASH_TO_NOTION = { "À faire": "Not started", "En cours": "In progress", "Fait": "Done" };

const PILIER_NOTION_TO_DASH = { "Acquisition": "acquisition", "Conversion": "conversion", "Produit": "produit", "Fondation": "fondation" };
const PILIER_DASH_TO_NOTION = { "acquisition": "Acquisition", "conversion": "Conversion", "produit": "Produit", "fondation": "Fondation" };

const IMPACT_NOTION_TO_DASH = { "⭐": 1, "⭐⭐": 2, "⭐⭐⭐": 3 };
const IMPACT_DASH_TO_NOTION = { 1: "⭐", 2: "⭐⭐", 3: "⭐⭐⭐" };

const RECUR_NOTION_TO_DASH = {
  "Ponctuel": 0,
  "Hebdo 1×": 1,
  "Hebdo 3×": 3,
  "Hebdo 5×": 5,
  "Mensuel": 1 // considéré comme "1 fois par période"
};
const RECUR_DASH_TO_NOTION = (n) => {
  if (n === 0) return "Ponctuel";
  if (n === 1) return "Hebdo 1×";
  if (n === 3) return "Hebdo 3×";
  if (n === 5) return "Hebdo 5×";
  if (n === 7) return "Hebdo 5×"; // fallback (Notion n'a pas "tous les jours")
  return "Hebdo 1×";
};

// Parse une page Notion → objet action dashboard
function parsePage(page) {
  const p = page.properties;
  const getSelect = (name) => p[name]?.select?.name || null;
  const getStatus = (name) => p[name]?.status?.name || null;
  const getNumber = (name) => p[name]?.number ?? 0;
  const getText = (name) => {
    const arr = p[name]?.rich_text || [];
    return arr.map(t => t.plain_text).join("");
  };
  const getTitle = (name) => {
    const arr = p[name]?.title || [];
    return arr.map(t => t.plain_text).join("");
  };
  const getDate = (name) => p[name]?.date?.start || null;

  const pillarNotion = getSelect("Pilier");
  const statusNotion = getStatus("Statut");
  const impactNotion = getSelect("Impact");
  const recurNotion = getSelect("Récurrence");

  return {
    id: page.id,
    name: getTitle("Action"),
    pillar: PILIER_NOTION_TO_DASH[pillarNotion] || "acquisition",
    type: getSelect("Type") || "B2C",
    status: STATUS_NOTION_TO_DASH[statusNotion] || "À faire",
    prio: getSelect("Priorité") || "Moyenne",
    impact: IMPACT_NOTION_TO_DASH[impactNotion] || 2,
    recur: RECUR_NOTION_TO_DASH[recurNotion] ?? 0,
    weekDone: getNumber("Fait cette semaine"),
    notes: getText("Notes"),
    dueDate: getDate("Due Date"),
    chantier: getSelect("Chantier"),
    step: p["Étape"]?.number ?? null
  };
}

// Objet action → propriétés Notion
function buildProperties(action) {
  const props = {};
  if (action.name !== undefined) {
    props["Action"] = { title: [{ text: { content: action.name } }] };
  }
  if (action.pillar !== undefined) {
    props["Pilier"] = { select: { name: PILIER_DASH_TO_NOTION[action.pillar] } };
  }
  if (action.type !== undefined) {
    props["Type"] = { select: { name: action.type } };
  }
  if (action.status !== undefined) {
    props["Statut"] = { status: { name: STATUS_DASH_TO_NOTION[action.status] } };
  }
  if (action.prio !== undefined) {
    props["Priorité"] = { select: { name: action.prio } };
  }
  if (action.impact !== undefined) {
    props["Impact"] = { select: { name: IMPACT_DASH_TO_NOTION[action.impact] } };
  }
  if (action.recur !== undefined) {
    props["Récurrence"] = { select: { name: RECUR_DASH_TO_NOTION(action.recur) } };
  }
  if (action.weekDone !== undefined) {
    props["Fait cette semaine"] = { number: action.weekDone };
  }
  if (action.chantier !== undefined) {
    props["Chantier"] = action.chantier ? { select: { name: action.chantier } } : { select: null };
  }
  if (action.step !== undefined) {
    props["Étape"] = { number: action.step };
  }
  return props;
}

// ===== Handlers =====

async function listActions() {
  const results = [];
  let cursor = undefined;
  do {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: cursor,
      page_size: 100
    });
    results.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return results.map(parsePage);
}

async function updateAction(id, patch) {
  await notion.pages.update({
    page_id: id,
    properties: buildProperties(patch)
  });
  return { ok: true };
}

async function createAction(action) {
  const response = await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties: buildProperties(action)
  });
  return { ok: true, id: response.id, ...parsePage(response) };
}

async function deleteAction(id) {
  await notion.pages.update({
    page_id: id,
    archived: true
  });
  return { ok: true };
}

async function appendHistory(id, text) {
  const today = new Date();
  const d = String(today.getDate()).padStart(2, "0");
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const y = today.getFullYear();
  const dateStr = `${d}/${m}/${y}`;

  // Récupère les blocs existants
  const blocks = await notion.blocks.children.list({ block_id: id, page_size: 50 });
  const hasHistoryHeading = blocks.results.some(
    b => b.type === "heading_2" && b.heading_2?.rich_text?.some(t => t.plain_text === "History")
  );

  const newBlocks = [];
  if (!hasHistoryHeading) {
    newBlocks.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "History" } }] }
    });
  }
  newBlocks.push({
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [
        { type: "text", text: { content: dateStr }, annotations: { bold: true } },
        { type: "text", text: { content: ` — ${text}` } }
      ]
    }
  });

  await notion.blocks.children.append({ block_id: id, children: newBlocks });
  return { ok: true };
}

// ===== Handler principal =====

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  try {
    if (!process.env.NOTION_TOKEN) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "NOTION_TOKEN not set" }) };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const action = body.action || (event.httpMethod === "GET" ? "list" : null);

    let result;
    switch (action) {
      case "list":
        result = await listActions();
        break;
      case "update":
        result = await updateAction(body.id, body.patch);
        break;
      case "create":
        result = await createAction(body.action);
        break;
      case "delete":
        result = await deleteAction(body.id);
        break;
      case "history":
        result = await appendHistory(body.id, body.text);
        break;
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action: " + action }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message, code: err.code, details: err.body })
    };
  }
};
