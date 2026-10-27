"""
AI-Assisted Student Grievance Redressal System - NLP Microservice
------------------------------------------------------------------
FastAPI service that classifies a student's grievance (English / Hinglish)
into a category and assigns a priority + SLA (in hours).

Run:
    pip install fastapi uvicorn scikit-learn pydantic
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
    # or simply: python main.py

Endpoint:
    POST /predict   { "text": "Mess ka khana thanda hai" }
    ->              { "category": "Mess & Dining", "priority": "Medium", "slaHours": 48 }
"""

import logging
import re
from contextlib import asynccontextmanager
from typing import List, Tuple

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score
from sklearn.pipeline import FeatureUnion, Pipeline

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger("nlp_service")

# ---------------------------------------------------------------------------
# 1. EMBEDDED TRAINING DATASET  (Hinglish + English)
# ---------------------------------------------------------------------------
MESS = "Mess & Dining"
HOSTEL = "Hostel"
IT = "IT Infrastructure"
ACADEMICS = "Academics"
SAFETY = "Anti-Ragging & Safety"

DATASET: List[Tuple[str, str]] = [
    # ---------------- Mess & Dining ----------------
    ("Mess ka khana thanda hai", MESS),
    ("Insect in food", MESS),
    ("Dal mein keede nikle aaj lunch mein", MESS),
    ("Food quality in the mess is very poor", MESS),
    ("Mess mein roti kachi aur jali hui hai", MESS),
    ("Dinner ke baad kai students ko food poisoning ho gayi", MESS),
    ("The canteen is serving stale and smelly food", MESS),
    ("Mess ke bartan gande hain aur hygiene bilkul nahi hai", MESS),
    ("Breakfast time pe nahi milta mess staff late aate hain", MESS),
    ("Hair found in rice served at dining hall", MESS),
    ("Paani mess mein ganda aa raha hai drinking water bad smell", MESS),
    ("Menu mein jo likha hai wo kabhi nahi banta", MESS),
    ("Mess menu is repetitive and there is no variety in dinner", MESS),
    ("Sabzi mein cockroach mila hai", MESS),
    ("Mess bill zyada charge kiya gaya hai is mahine", MESS),

    # ---------------- Hostel ----------------
    ("Hostel B washroom pipe leak ho raha hai", HOSTEL),
    ("Fan broken", HOSTEL),
    ("Room ka fan kaam nahi kar raha hai", HOSTEL),
    ("Hostel mein geyser kharab hai garam paani nahi aata", HOSTEL),
    ("Bathroom ka tap toot gaya hai paani bah raha hai", HOSTEL),
    ("Room light not working in hostel block C", HOSTEL),
    ("Hostel room mein bijli ka switch spark kar raha hai short circuit", HOSTEL),
    ("Washroom is very dirty and not cleaned for three days", HOSTEL),
    ("Hostel ke corridor mein safai nahi hoti sweeper nahi aata", HOSTEL),
    ("Bed and mattress in my hostel room are damaged", HOSTEL),
    ("Room ki window ka glass toot gaya hai", HOSTEL),
    ("Water cooler on hostel second floor is not working", HOSTEL),
    ("Hostel mein roommate change karwana hai room allotment issue", HOSTEL),
    ("Hostel ki chhat se paani tapak raha hai barish mein", HOSTEL),
    ("Laundry machine hostel mein kharab padi hai", HOSTEL),

    # ---------------- IT Infrastructure ----------------
    ("WiFi lab 3 PC 12 broken", IT),
    ("Campus WiFi bahut slow chal raha hai", IT),
    ("Internet not working in library since morning", IT),
    ("Computer lab ka projector kaam nahi kar raha", IT),
    ("Lab PC mein software install nahi ho raha license expired", IT),
    ("College portal login nahi ho raha password reset chahiye", IT),
    ("Student ERP website is down cannot see attendance", IT),
    ("Printer in the computer centre is out of order", IT),
    ("Lab 2 ke system mein keyboard aur mouse kharab hain", IT),
    ("LMS pe assignment upload nahi ho raha error aa raha hai", IT),
    ("Email ID college ki access nahi ho rahi account locked", IT),
    ("Hostel WiFi router band hai signal nahi aa raha", IT),
    ("Smart classroom ka monitor aur speaker not working", IT),
    ("Online exam portal crash ho gaya tha server error", IT),
    ("Lab computers are very slow and keep hanging", IT),

    # ---------------- Academics ----------------
    ("Marksheet correction needed", ACADEMICS),
    ("Meri marksheet mein naam ki spelling galat hai", ACADEMICS),
    ("Internal marks are not updated on the portal", ACADEMICS),
    ("Result mein ek subject ke marks galat dikh rahe hain revaluation chahiye", ACADEMICS),
    ("Attendance shortage condonation ke liye apply karna hai", ACADEMICS),
    ("Need bonafide certificate for scholarship", ACADEMICS),
    ("Exam timetable clash ho raha hai do papers same din", ACADEMICS),
    ("Professor is not completing the syllabus on time", ACADEMICS),
    ("Faculty regularly class nahi leti hai lectures miss ho rahe hain", ACADEMICS),
    ("Request for re-evaluation of my answer sheet", ACADEMICS),
    ("Fee receipt mein galti hai aur scholarship credit nahi hua", ACADEMICS),
    ("Backlog exam form fill nahi ho raha hai", ACADEMICS),
    ("Degree certificate aur transcript issue karwana hai", ACADEMICS),
    ("Assignment marks were not given despite submission", ACADEMICS),
    ("Practical exam ka result abhi tak declare nahi hua", ACADEMICS),

    # ---------------- Anti-Ragging & Safety ----------------
    ("Main gate latch broken safety issue", SAFETY),
    ("Seniors are ragging first year students in hostel", SAFETY),
    ("Senior mujhe roz tang karte hain aur dhamki dete hain", SAFETY),
    ("Street lights near the girls hostel are not working at night", SAFETY),
    ("Koi mujhe harass kar raha hai aur blackmail kar raha hai", SAFETY),
    ("Fire extinguisher in the hostel corridor is empty", SAFETY),
    ("Campus mein CCTV camera band hain raat ko safe nahi lagta", SAFETY),
    ("Bullying and physical assault by seniors near the parking", SAFETY),
    ("Ragging ho rahi hai mujhe forcefully dance karwaya gaya", SAFETY),
    ("Unknown outsiders enter the campus without any security check", SAFETY),
    ("Hostel ka back gate raat ko khula rehta hai security guard nahi hota", SAFETY),
    ("Girls hostel ke bahar eve teasing ho rahi hai", SAFETY),
    ("Emergency exit door of the building is locked", SAFETY),
    ("Boundary wall toot gayi hai koi bhi andar aa sakta hai", SAFETY),
    ("I feel unsafe because a student is stalking me", SAFETY),
]

# ---------------------------------------------------------------------------
# 2. PRIORITY & SLA RULES
# ---------------------------------------------------------------------------
PRIORITY_ORDER = ["Low", "Medium", "High", "Immediate"]

SLA_HOURS = {
    "Immediate": 6,
    "High": 24,
    "Medium": 48,
    "Low": 72,
}

# Baseline priority for each category
CATEGORY_BASE_PRIORITY = {
    MESS: "Medium",
    HOSTEL: "Medium",
    IT: "Medium",
    ACADEMICS: "Low",
    SAFETY: "Immediate",   # safety / ragging is always handled immediately
}

# Keywords that escalate the priority regardless of category (matched on lowercase text)
IMMEDIATE_KEYWORDS = [
    "insect", "keede", "keeda", "cockroach", "lizard", "chipkali", "worm",
    "food poisoning", "poison", "vomit", "ulti", "hospital", "medical emergency",
    "fire", "aag", "short circuit", "spark", "electric shock", "current lag",
    "ragging", "harass", "blackmail", "assault", "stalk", "threat", "dhamki",
    "unsafe", "emergency", "suicide", "molest", "eve teasing", "bullying",
]

HIGH_KEYWORDS = [
    "leak", "tapak", "bah raha", "flood", "sewage", "overflow",
    "no water", "paani nahi", "garam paani nahi", "not working since",
    "down", "crash", "server error", "locked", "toot gaya", "toot gayi",
    "broken", "exam tomorrow", "kal exam", "deadline", "scholarship",
    "not cleaned", "dirty", "ganda", "smell", "stale", "latch",
]

LOW_KEYWORDS = [
    "suggestion", "request", "menu", "variety", "repetitive", "certificate",
    "spelling", "bonafide", "transcript",
]


def _contains_any(text: str, keywords: List[str]) -> bool:
    return any(kw in text for kw in keywords)


def determine_priority(text: str, category: str) -> str:
    """Combine category baseline with keyword-based urgency escalation."""
    lowered = text.lower()
    priority = CATEGORY_BASE_PRIORITY.get(category, "Medium")

    if _contains_any(lowered, IMMEDIATE_KEYWORDS):
        return "Immediate"

    if _contains_any(lowered, HIGH_KEYWORDS):
        # escalate to at least High (never downgrade)
        if PRIORITY_ORDER.index(priority) < PRIORITY_ORDER.index("High"):
            priority = "High"

    elif _contains_any(lowered, LOW_KEYWORDS) and category != SAFETY:
        priority = "Low"

    return priority


# ---------------------------------------------------------------------------
# 3. MODEL: TF-IDF (word + char n-grams) + LOGISTIC REGRESSION
# ---------------------------------------------------------------------------
def preprocess(text: str) -> str:
    """Light normalisation that works for mixed Hinglish/English text."""
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\u0900-\u097F\s]", " ", text)  # keep Latin, digits, Devanagari
    text = re.sub(r"\s+", " ", text)
    return text


def build_pipeline() -> Pipeline:
    features = FeatureUnion(
        [
            (
                "word_tfidf",
                TfidfVectorizer(
                    preprocessor=preprocess,
                    analyzer="word",
                    ngram_range=(1, 2),
                    sublinear_tf=True,
                    min_df=1,
                ),
            ),
            (
                # char n-grams make the model robust to Hinglish spelling variations
                # (e.g. "kharab" / "kharaab", "thanda" / "thanda")
                "char_tfidf",
                TfidfVectorizer(
                    preprocessor=preprocess,
                    analyzer="char_wb",
                    ngram_range=(2, 5),
                    sublinear_tf=True,
                    min_df=1,
                ),
            ),
        ]
    )
    classifier = LogisticRegression(
        C=10.0,
        max_iter=2000,
        class_weight="balanced",
        random_state=42,
    )
    return Pipeline([("features", features), ("clf", classifier)])


model: Pipeline = build_pipeline()


def train_model() -> None:
    texts = [t for t, _ in DATASET]
    labels = [l for _, l in DATASET]

    logger.info("Training on %d samples across %d categories", len(texts), len(set(labels)))

    try:
        scores = cross_val_score(build_pipeline(), texts, labels, cv=5)
        logger.info("5-fold CV accuracy: %.2f (+/- %.2f)", scores.mean(), scores.std())
    except Exception as exc:  # CV is informational only
        logger.warning("Cross-validation skipped: %s", exc)

    model.fit(texts, labels)
    logger.info("Model trained successfully")


# ---------------------------------------------------------------------------
# 4. FASTAPI APP
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(_: FastAPI):
    train_model()
    yield


app = FastAPI(
    title="Grievance NLP Service",
    description="Classifies student grievances and assigns priority + SLA.",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow the Node/Express server (and React dev server) to call this service
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Student complaint text")


class PredictResponse(BaseModel):
    category: str
    priority: str
    slaHours: int


@app.get("/")
def health() -> dict:
    return {"status": "ok", "service": "grievance-nlp", "samples": len(DATASET)}


@app.post("/predict", response_model=PredictResponse)
def predict(payload: PredictRequest) -> PredictResponse:
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="`text` must not be empty")

    category = str(model.predict([text])[0])
    priority = determine_priority(text, category)
    sla_hours = SLA_HOURS[priority]

    logger.info("Predicted | %-22s | %-9s | %2dh | %s", category, priority, sla_hours, text[:60])
    return PredictResponse(category=category, priority=priority, slaHours=sla_hours)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)