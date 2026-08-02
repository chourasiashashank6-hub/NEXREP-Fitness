from __future__ import annotations

import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

SUPPORTED_CATALOG_LANGUAGES = ("en", "hi", "hinglish", "es", "fr", "de")


_PHRASE_TRANSLATIONS: dict[str, dict[str, str]] = {
    "hi": {
        "bench press": "बेंच प्रेस",
        "incline bench press": "इन्क्लाइन बेंच प्रेस",
        "decline bench press": "डिक्लाइन बेंच प्रेस",
        "shoulder press": "शोल्डर प्रेस",
        "overhead press": "ओवरहेड प्रेस",
        "chest press": "चेस्ट प्रेस",
        "leg press": "लेग प्रेस",
        "deadlift": "डेडलिफ्ट",
        "romanian deadlift": "रोमानियन डेडलिफ्ट",
        "squat": "स्क्वैट",
        "front squat": "फ्रंट स्क्वैट",
        "hack squat": "हैक स्क्वैट",
        "lunge": "लंज",
        "curl": "कर्ल",
        "biceps curl": "बाइसेप्स कर्ल",
        "triceps extension": "ट्राइसेप्स एक्सटेंशन",
        "push up": "पुश-अप",
        "pull up": "पुल-अप",
        "chin up": "चिन-अप",
        "row": "रो",
        "lat pulldown": "लैट पुलडाउन",
        "plank": "प्लैंक",
        "crunch": "क्रंच",
        "calf raise": "काफ रेज",
        "leg curl": "लेग कर्ल",
        "leg extension": "लेग एक्सटेंशन",
        "hip thrust": "हिप थ्रस्ट",
        "glute bridge": "ग्लूट ब्रिज",
        "lateral raise": "लेटरल रेज",
        "face pull": "फेस पुल",
        "fly": "फ्लाई",
        "cable": "केबल",
        "dumbbell": "डम्बल",
        "barbell": "बारबेल",
        "machine": "मशीन",
        "rice": "चावल",
        "wheat": "गेहूं",
        "bread": "ब्रेड",
        "milk": "दूध",
        "curd": "दही",
        "yogurt": "दही",
        "paneer": "पनीर",
        "chicken": "चिकन",
        "egg": "अंडा",
        "fish": "मछली",
        "apple": "सेब",
        "banana": "केला",
        "potato": "आलू",
        "tomato": "टमाटर",
        "onion": "प्याज",
        "lentil": "दाल",
        "dal": "दाल",
    },
    "hinglish": {
        "bench press": "bench press",
        "incline bench press": "incline bench press",
        "decline bench press": "decline bench press",
        "shoulder press": "shoulder press",
        "overhead press": "overhead press",
        "leg press": "leg press",
        "deadlift": "deadlift",
        "squat": "squat",
        "front squat": "front squat",
        "lunge": "lunge",
        "push up": "push-up",
        "pull up": "pull-up",
        "chin up": "chin-up",
        "rice": "chawal",
        "wheat": "gehu",
        "milk": "doodh",
        "curd": "dahi",
        "yogurt": "dahi",
        "paneer": "paneer",
        "chicken": "chicken",
        "egg": "anda",
        "fish": "fish",
        "apple": "seb",
        "banana": "kela",
        "potato": "aloo",
        "tomato": "tamatar",
        "onion": "pyaaz",
        "lentil": "dal",
        "cooked": "paka hua",
        "plain": "sada",
        "whole": "poora",
        "white": "safed",
        "brown": "brown",
        "raw": "kaccha",
        "boiled": "ubla hua",
        "dry": "dry",
        "flour": "atta",
        "bread": "bread",
        "cow": "cow",
    },
    "es": {
        "bench press": "press de banca",
        "incline bench press": "press de banca inclinado",
        "decline bench press": "press de banca declinado",
        "shoulder press": "press de hombros",
        "overhead press": "press por encima de la cabeza",
        "chest press": "press de pecho",
        "leg press": "prensa de piernas",
        "deadlift": "peso muerto",
        "romanian deadlift": "peso muerto rumano",
        "squat": "sentadilla",
        "front squat": "sentadilla frontal",
        "lunge": "zancada",
        "curl": "curl",
        "push up": "flexión",
        "pull up": "dominada",
        "chin up": "dominada supina",
        "row": "remo",
        "lat pulldown": "jalón al pecho",
        "plank": "plancha",
        "crunch": "abdominal corto",
        "calf raise": "elevación de gemelos",
        "leg curl": "curl de piernas",
        "leg extension": "extensión de piernas",
        "hip thrust": "hip thrust",
        "glute bridge": "puente de glúteos",
        "lateral raise": "elevación lateral",
        "face pull": "face pull",
        "fly": "apertura",
        "rice": "arroz",
        "wheat": "trigo",
        "bread": "pan",
        "milk": "leche",
        "curd": "cuajada",
        "yogurt": "yogur",
        "paneer": "paneer",
        "chicken": "pollo",
        "egg": "huevo",
        "fish": "pescado",
        "apple": "manzana",
        "banana": "plátano",
        "potato": "patata",
        "tomato": "tomate",
        "onion": "cebolla",
        "lentil": "lenteja",
    },
    "fr": {
        "bench press": "développé couché",
        "incline bench press": "développé incliné",
        "decline bench press": "développé décliné",
        "shoulder press": "développé épaules",
        "overhead press": "développé au-dessus de la tête",
        "chest press": "presse pectorale",
        "leg press": "presse à jambes",
        "deadlift": "soulevé de terre",
        "romanian deadlift": "soulevé de terre roumain",
        "squat": "squat",
        "front squat": "front squat",
        "lunge": "fente",
        "curl": "curl",
        "push up": "pompe",
        "pull up": "traction",
        "chin up": "traction supination",
        "row": "rowing",
        "lat pulldown": "tirage vertical",
        "plank": "gainage",
        "crunch": "crunch",
        "calf raise": "élévation des mollets",
        "leg curl": "leg curl",
        "leg extension": "extension des jambes",
        "hip thrust": "hip thrust",
        "glute bridge": "pont fessier",
        "lateral raise": "élévation latérale",
        "face pull": "face pull",
        "fly": "écarté",
        "rice": "riz",
        "wheat": "blé",
        "bread": "pain",
        "milk": "lait",
        "curd": "lait caillé",
        "yogurt": "yaourt",
        "paneer": "paneer",
        "chicken": "poulet",
        "egg": "œuf",
        "fish": "poisson",
        "apple": "pomme",
        "banana": "banane",
        "potato": "pomme de terre",
        "tomato": "tomate",
        "onion": "oignon",
        "lentil": "lentille",
    },
    "de": {
        "bench press": "Bankdrücken",
        "incline bench press": "Schrägbankdrücken",
        "decline bench press": "Negativbankdrücken",
        "shoulder press": "Schulterdrücken",
        "overhead press": "Überkopfdrücken",
        "chest press": "Brustpresse",
        "leg press": "Beinpresse",
        "deadlift": "Kreuzheben",
        "romanian deadlift": "Rumänisches Kreuzheben",
        "squat": "Kniebeuge",
        "front squat": "Frontkniebeuge",
        "lunge": "Ausfallschritt",
        "curl": "Curl",
        "push up": "Liegestütz",
        "pull up": "Klimmzug",
        "chin up": "Klimmzug im Untergriff",
        "row": "Rudern",
        "lat pulldown": "Latzug",
        "plank": "Plank",
        "crunch": "Crunch",
        "calf raise": "Wadenheben",
        "leg curl": "Beinbeuger",
        "leg extension": "Beinstrecker",
        "hip thrust": "Hip Thrust",
        "glute bridge": "Glute Bridge",
        "lateral raise": "Seitheben",
        "face pull": "Face Pull",
        "fly": "Fliegende",
        "rice": "Reis",
        "wheat": "Weizen",
        "bread": "Brot",
        "milk": "Milch",
        "curd": "Quark",
        "yogurt": "Joghurt",
        "paneer": "Paneer",
        "chicken": "Hähnchen",
        "egg": "Ei",
        "fish": "Fisch",
        "apple": "Apfel",
        "banana": "Banane",
        "potato": "Kartoffel",
        "tomato": "Tomate",
        "onion": "Zwiebel",
        "lentil": "Linse",
    },
}

_CATEGORY_TRANSLATIONS: dict[str, dict[str, str]] = {
    "hi": {
        "breakfast": "नाश्ता",
        "beverage": "पेय",
        "beverages": "पेय",
        "fruit": "फल",
        "fruits": "फल",
        "vegetable": "सब्जी",
        "vegetables": "सब्जियां",
        "grains": "अनाज",
        "dairy": "डेयरी",
        "protein": "प्रोटीन",
        "snacks": "स्नैक्स",
        "strength": "स्ट्रेंथ",
        "cardio": "कार्डियो",
        "full body": "फुल बॉडी",
    },
    "hinglish": {
        "breakfast": "breakfast",
        "beverage": "drink",
        "beverages": "drinks",
        "fruit": "fruit",
        "fruits": "fruits",
        "vegetable": "sabzi",
        "vegetables": "sabziyan",
        "grains": "grains",
        "dairy": "dairy",
        "protein": "protein",
        "snacks": "snacks",
        "strength": "strength",
        "cardio": "cardio",
        "full body": "full body",
    },
    "es": {
        "breakfast": "desayuno",
        "beverage": "bebida",
        "beverages": "bebidas",
        "fruit": "fruta",
        "fruits": "frutas",
        "vegetable": "verdura",
        "vegetables": "verduras",
        "grains": "cereales",
        "dairy": "lácteos",
        "protein": "proteína",
        "snacks": "snacks",
        "strength": "fuerza",
        "cardio": "cardio",
        "full body": "cuerpo completo",
    },
    "fr": {
        "breakfast": "petit-déjeuner",
        "beverage": "boisson",
        "beverages": "boissons",
        "fruit": "fruit",
        "fruits": "fruits",
        "vegetable": "légume",
        "vegetables": "légumes",
        "grains": "céréales",
        "dairy": "produits laitiers",
        "protein": "protéine",
        "snacks": "collations",
        "strength": "force",
        "cardio": "cardio",
        "full body": "corps entier",
    },
    "de": {
        "breakfast": "Frühstück",
        "beverage": "Getränk",
        "beverages": "Getränke",
        "fruit": "Obst",
        "fruits": "Obst",
        "vegetable": "Gemüse",
        "vegetables": "Gemüse",
        "grains": "Getreide",
        "dairy": "Milchprodukte",
        "protein": "Protein",
        "snacks": "Snacks",
        "fast food": "Fast Food",
        "legume pulse": "Hülsenfrüchte",
        "strength": "Kraft",
        "cardio": "Cardio",
        "full body": "Ganzkörper",
    },
}


_EXACT_LABEL_OVERRIDES: dict[str, dict[str, str]] = {
    "hi": {
        "barbell 21s": "बारबेल 21 रेप्स",
        "salmon sushi (nigiri, 2pc)": "सैल्मन सुशी (निगिरी, 2 पीस)",
        "tuna sushi (nigiri, 2pc)": "टूना सुशी (निगिरी, 2 पीस)",
        "california roll (6pc)": "कैलिफोर्निया रोल (6 पीस)",
        "chicken nuggets (6pc)": "चिकन नगेट्स (6 पीस)",
        "margherita pizza (whole, 30cm)": "मार्गेरीटा पिज़्ज़ा (साबुत, 30 सेमी)",
        "rye crispbread (knäckebröd)": "राई क्रिस्पब्रेड (क्नैकेब्रेड)",
        "beer (regular lager, per 355ml)": "बीयर (रेगुलर लेगर, प्रति 355 मि.ली.)",
        "wine (red, per 150ml)": "रेड वाइन (प्रति 150 मि.ली.)",
        "wine (white, per 150ml)": "व्हाइट वाइन (प्रति 150 मि.ली.)",
        "whisky / rum / vodka (30ml)": "व्हिस्की / रम / वोडका (30 मि.ली.)",
        "chapati (plain)": "चपाती (सादा)",
        "paratha (plain)": "पराठा (सादा)",
        "aloo paratha": "आलू पराठा",
        "naan bread": "नान ब्रेड",
        "puri": "पूरी",
        "bhatura": "भटूरा",
        "idli (steamed)": "इडली (स्टीम्ड)",
        "dosa (plain)": "डोसा (सादा)",
        "masala dosa": "मसाला डोसा",
        "uttapam": "उत्तपम",
        "upma": "उपमा",
        "poha (cooked)": "पोहा (पका हुआ)",
        "khichdi": "खिचड़ी",
        "semolina / suji (dry)": "सूजी (सूखी)",
        "whole wheat flour (atta)": "गेहूं का आटा",
        "maida (refined flour)": "मैदा",
        "besan (chickpea flour)": "बेसन",
        "bajra / pearl millet (cooked)": "बाजरा (पका हुआ)",
        "jowar / sorghum (cooked)": "ज्वार (पका हुआ)",
        "ragi / finger millet (cooked)": "रागी (पका हुआ)",
        "oats (rolled, dry)": "रोल्ड ओट्स (सूखे)",
        "oats (cooked)": "ओट्स (पके हुए)",
        "quinoa (cooked)": "क्विनोआ (पका हुआ)",
        "barley (cooked)": "जौ (पका हुआ)",
        "corn / maize (cooked)": "मक्का (पका हुआ)",
        "popcorn (air-popped)": "पॉपकॉर्न (एयर-पॉप्ड)",
        "cornflakes (plain)": "कॉर्नफ्लेक्स (सादे)",
        "toor dal (cooked)": "तूर दाल (पकी हुई)",
        "moong dal (yellow, cooked)": "पीली मूंग दाल (पकी हुई)",
        "masoor dal (red lentil, cooked)": "मसूर दाल (पकी हुई)",
        "chana dal (cooked)": "चना दाल (पकी हुई)",
        "urad dal (cooked)": "उड़द दाल (पकी हुई)",
        "rajma / kidney beans (cooked)": "राजमा (पका हुआ)",
        "chole / chickpeas (cooked)": "छोले (पके हुए)",
        "black-eyed peas (cooked)": "लोबिया (पका हुआ)",
        "moong sprouts (raw)": "मूंग स्प्राउट्स (कच्चे)",
        "soybean (cooked)": "सोयाबीन (पका हुआ)",
        "green peas (cooked)": "हरी मटर (पकी हुई)",
        "moth beans (cooked)": "मटकी दाल (पकी हुई)",
        "lobia / black-eyed peas": "लोबिया",
        "dal makhani": "दाल मखनी",
        "palak paneer": "पालक पनीर",
        "paneer butter masala": "पनीर बटर मसाला",
        "chole masala": "छोले मसाला",
        "aloo gobi": "आलू गोभी",
        "baingan bharta": "बैंगन भरता",
        "mixed vegetable curry": "मिक्स वेजिटेबल करी",
        "sambar": "सांभर",
        "rasam": "रसम",
        "butter chicken": "बटर चिकन",
        "chicken tikka masala": "चिकन टिक्का मसाला",
        "chicken curry (home)": "घर की चिकन करी",
        "mutton curry": "मटन करी",
        "fish curry (goan/kerala)": "फिश करी (गोअन/केरल)",
        "egg curry": "अंडा करी",
        "prawn masala": "प्रॉन मसाला",
        "matar paneer": "मटर पनीर",
        "chicken biryani": "चिकन बिरयानी",
        "vegetable biryani": "वेजिटेबल बिरयानी",
        "mutton biryani": "मटन बिरयानी",
        "saag (sarson da saag)": "साग (सरसों दा साग)",
        "kadhi pakora": "कढ़ी पकोड़ा",
        "bhindi masala (okra)": "भिंडी मसाला",
        "aloo matar": "आलू मटर",
        "kofta curry (veg)": "वेज कोफ्ता करी",
        "navratan korma": "नवरतन कोरमा",
        "pindi chana": "पिंडी चना",
        "keema matar": "कीमा मटर",
        "chicken keema": "चिकन कीमा",
        "lamb rogan josh": "लैम्ब रोगन जोश",
        "chicken saag": "चिकन साग",
        "dal tadka": "दाल तड़का",
        "paneer tikka masala": "पनीर टिक्का मसाला",
        "samosa (vegetable)": "वेजिटेबल समोसा",
        "pakora (vegetable)": "वेजिटेबल पकोड़ा",
        "vada pav": "वड़ा पाव",
        "pav bhaji": "पाव भाजी",
        "bhel puri": "भेल पूरी",
        "pani puri / golgappa": "पानी पूरी / गोलगप्पा",
        "dhokla": "ढोकला",
        "kachori": "कचौरी",
        "medu vada": "मेदू वड़ा",
        "aloo tikki": "आलू टिक्की",
        "chaat (aloo chaat)": "चाट (आलू चाट)",
        "dahi puri": "दही पूरी",
        "sev puri": "सेव पूरी",
        "papadum (roasted)": "पापड़ (भुना हुआ)",
        "papadum (fried)": "पापड़ (तला हुआ)",
        "murmura / puffed rice": "मुरमुरा",
        "handvo": "हांडवो",
        "thepla": "थेपला",
        "chakli": "चकली",
        "murukku": "मुरुक्कू",
        "gulab jamun": "गुलाब जामुन",
        "rasgulla": "रसगुल्ला",
        "jalebi": "जलेबी",
        "halwa (suji / wheat)": "हलवा (सूजी / गेहूं)",
        "kheer (rice pudding)": "खीर",
        "barfi (milk)": "बर्फी (दूध)",
        "ladoo (besan)": "बेसन लड्डू",
        "ladoo (motichoor)": "मोतीचूर लड्डू",
        "payasam (vermicelli)": "पायसम (सेवई)",
        "gajar halwa": "गाजर हलवा",
        "peda": "पेड़ा",
        "rasmalai": "रसमलाई",
        "kulfi (plain)": "कुल्फी (सादी)",
        "shrikhand": "श्रीखंड",
        "modak (steamed)": "मोदक (स्टीम्ड)",
        "spinach (raw)": "पालक (कच्चा)",
        "garlic (raw)": "लहसुन (कच्चा)",
        "ginger (raw)": "अदरक (कच्चा)",
        "sweet potato (baked)": "शकरकंद (बेक्ड)",
        "carrot (raw)": "गाजर (कच्ची)",
        "broccoli (raw)": "ब्रोकली (कच्ची)",
    },
    "hinglish": {
        "whole wheat flour (atta)": "poora gehu atta",
        "egg white (raw)": "anda white (kaccha)",
        "whole milk": "poora doodh",
        "plain yogurt (whole)": "sada dahi (poora)",
        "greek yogurt (plain)": "greek dahi (sada)",
        "whole wheat bread": "gehu ki bread",
        "whole wheat pasta (cooked)": "gehu pasta (paka hua)",
        "fried rice (chicken)": "fried chawal (chicken)",
        "onigiri (rice ball, plain)": "onigiri (chawal ball, sada)",
        "potato chips (plain)": "aloo chips (sada)",
        "rice cakes (plain)": "chawal cakes (sada)",
        "yogurt (probiotic plain)": "dahi (probiotic sada)",
    },
    "es": {
        "smith machine bench press": "press de banca en máquina Smith",
    },
    "fr": {
        "machine chest press": "presse pectorale à la machine",
        "smith machine bench press": "développé couché à la Smith machine",
        "machine row": "rowing à la machine",
        "machine shoulder press": "développé épaules à la machine",
    },
    "de": {
        "smith machine bench press": "Bankdrücken an der Smith-Maschine",
        "chicken burger (fast food)": "Hähnchenburger (Fast Food)",
        "veggie burger": "Gemüseburger",
        "lentil burger patty": "Linsen-Burger-Patty",
    },
}


_TOKEN_TRANSLATIONS: dict[str, dict[str, str]] = {
    "hi": {
        "incline": "इन्क्लाइन",
        "decline": "डिक्लाइन",
        "flat": "फ्लैट",
        "wide": "वाइड",
        "close": "क्लोज",
        "grip": "ग्रिप",
        "high": "हाई",
        "low": "लो",
        "seated": "सीटेड",
        "standing": "स्टैंडिंग",
        "lying": "लाइंग",
        "single": "सिंगल",
        "arm": "आर्म",
        "leg": "लेग",
        "chest": "चेस्ट",
        "rear": "रियर",
        "delt": "डेल्ट",
        "pec": "पेक",
        "deck": "डेक",
        "smith": "स्मिथ",
        "resistance": "रेजिस्टेंस",
        "band": "बैंड",
        "sumo": "सूमो",
        "trap": "ट्रैप",
        "bar": "बार",
        "pendlay": "पेंडले",
        "t": "टी",
        "weighted": "वेटेड",
        "assisted": "असिस्टेड",
        "floor": "फ्लोर",
        "svend": "स्वेंड",
        "pullover": "पुलओवर",
        "crossover": "क्रॉसओवर",
        "spiderman": "स्पाइडरमैन",
        "diamond": "डायमंड",
        "plyometric": "प्लायोमेट्रिक",
        "press": "प्रेस",
        "raise": "रेज",
        "extension": "एक्सटेंशन",
        "hammer": "हैमर",
        "reverse": "रिवर्स",
        "zottman": "ज़ॉटमैन",
        "preacher": "प्रीचर",
        "skullcrusher": "स्कलक्रशर",
        "dip": "डिप",
        "shrug": "श्रग",
        "thruster": "थ्रस्टर",
        "burpee": "बर्पी",
        "mountain": "माउंटेन",
        "climber": "क्लाइंबर",
        "jumping": "जंपिंग",
        "jack": "जैक",
        "battle": "बैटल",
        "rope": "रोप",
        "kettlebell": "केटलबेल",
        "clean": "क्लीन",
        "snatch": "स्नैच",
        "carry": "कैरी",
        "farmer": "फार्मर",
        "turkish": "टर्किश",
        "get": "गेट",
        "up": "अप",
        "to": "टू",
        "basmati": "बासमती",
        "white": "सफेद",
        "brown": "ब्राउन",
        "cooked": "पका हुआ",
        "plain": "सादा",
        "whole": "साबुत",
        "raw": "कच्चा",
        "boiled": "उबला हुआ",
        "dry": "सूखा",
        "flour": "आटा",
        "refined": "रिफाइंड",
        "chickpea": "चना",
        "red": "लाल",
        "greek": "ग्रीक",
        "probiotic": "प्रोबायोटिक",
        "wild": "वाइल्ड",
        "fried": "फ्राइड",
        "ball": "बॉल",
        "cakes": "केक्स",
        "chips": "चिप्स",
        "cow": "गाय",
    },
    "hinglish": {
        "cooked": "cooked",
        "plain": "plain",
        "whole": "whole",
        "white": "white",
        "brown": "brown",
        "flour": "atta",
        "chicken": "chicken",
    },
    "es": {
        "barbell": "barra",
        "dumbbell": "mancuerna",
        "cable": "polea",
        "machine": "máquina",
        "smith": "Smith",
        "incline": "inclinado",
        "decline": "declinado",
        "chest": "pecho",
        "seated": "sentado",
        "weighted": "con peso",
        "whole": "entero",
        "white": "blanco",
        "brown": "integral",
        "cooked": "cocido",
        "plain": "natural",
        "raw": "crudo",
        "boiled": "hervido",
        "dry": "seco",
        "flour": "harina",
        "butter": "mantequilla",
    },
    "fr": {
        "barbell": "barre",
        "dumbbell": "haltère",
        "cable": "poulie",
        "machine": "machine",
        "smith": "Smith",
        "incline": "incliné",
        "decline": "décliné",
        "chest": "pectoraux",
        "seated": "assis",
        "weighted": "lesté",
        "whole": "entier",
        "white": "blanc",
        "brown": "complet",
        "cooked": "cuit",
        "plain": "nature",
        "raw": "cru",
        "boiled": "bouilli",
        "dry": "sec",
        "flour": "farine",
        "butter": "beurre",
    },
    "de": {
        "barbell": "Langhantel",
        "dumbbell": "Kurzhantel",
        "cable": "Kabelzug",
        "machine": "Maschine",
        "smith": "Smith",
        "incline": "Schrägbank",
        "decline": "Negativbank",
        "chest": "Brust",
        "seated": "sitzend",
        "weighted": "mit Zusatzgewicht",
        "whole": "Voll",
        "white": "weiß",
        "brown": "braun",
        "cooked": "gekocht",
        "plain": "natur",
        "raw": "roh",
        "boiled": "gekocht",
        "dry": "trocken",
        "flour": "Mehl",
        "butter": "Butter",
    },
}


_HI_ROMAN_FALLBACK = {
    "a": "अ",
    "b": "ब",
    "c": "क",
    "d": "द",
    "e": "े",
    "f": "फ",
    "g": "ग",
    "h": "ह",
    "i": "ि",
    "j": "ज",
    "k": "क",
    "l": "ल",
    "m": "म",
    "n": "न",
    "o": "ो",
    "p": "प",
    "q": "क",
    "r": "र",
    "s": "स",
    "t": "ट",
    "u": "ु",
    "v": "व",
    "w": "व",
    "x": "क्स",
    "y": "य",
    "z": "ज़",
}


def _rough_hi_transliterate(token: str) -> str:
    lowered = token.lower()
    if lowered in _TOKEN_TRANSLATIONS["hi"]:
        return _TOKEN_TRANSLATIONS["hi"][lowered]
    return "".join(_HI_ROMAN_FALLBACK.get(ch, ch) for ch in lowered)


def _replace_latin_tokens(value: str, language: str) -> str:
    tokens = _TOKEN_TRANSLATIONS.get(language, {})

    def repl(match: re.Match[str]) -> str:
        token = match.group(0)
        lowered = token.lower()
        if language == "hi":
            return _rough_hi_transliterate(token)
        return tokens.get(lowered, token)

    return re.sub(r"\b[A-Za-z]+\b", repl, value)


def _title_like(source: str, value: str, language: str) -> str:
    if language in {"hi", "hinglish"}:
        return value
    if source.isupper():
        return value.upper()
    if source[:1].isupper():
        return value[:1].upper() + value[1:]
    return value


def translate_catalog_label(value: Any, language: str) -> str:
    source = " ".join(str(value or "").strip().replace("_", " ").split())
    if not source or language == "en":
        return source
    override = _EXACT_LABEL_OVERRIDES.get(language, {}).get(source.lower())
    if override:
        return override
    table = _PHRASE_TRANSLATIONS.get(language, {})
    lowered = source.lower().replace("-", " ")
    if lowered in table:
        return _title_like(source, table[lowered], language)

    translated = lowered
    for key in sorted(table, key=len, reverse=True):
        translated = re.sub(rf"\b{re.escape(key)}\b", table[key], translated)
    translated = _replace_latin_tokens(translated, language)
    if translated == lowered and language != "hi":
        return source
    return _title_like(source, translated, language)


def translate_category_label(value: Any, language: str) -> str:
    source = " ".join(str(value or "").strip().replace("_", " ").split())
    if not source or language == "en":
        return source
    translated = _CATEGORY_TRANSLATIONS.get(language, {}).get(source.lower())
    return _title_like(source, translated, language) if translated else translate_catalog_label(source, language)


def ensure_catalog_label_schema(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS global_exercise_labels (
                    id BIGSERIAL PRIMARY KEY,
                    exercise_id BIGINT NOT NULL REFERENCES global_exercises(id) ON DELETE CASCADE,
                    language_tag VARCHAR(32) NOT NULL,
                    label TEXT NOT NULL,
                    aliases TEXT[] NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT uq_global_exercise_label_language UNIQUE (exercise_id, language_tag)
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_global_exercise_labels_exercise_id ON global_exercise_labels(exercise_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_global_exercise_labels_language_tag ON global_exercise_labels(language_tag)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_global_exercise_labels_label_lower ON global_exercise_labels((LOWER(label)))"))


def seed_catalog_labels(engine: Engine, *, overwrite: bool = False) -> dict[str, int]:
    ensure_catalog_label_schema(engine)
    counts = {"global_exercise_labels": 0, "food_item_labels": 0, "food_category_labels": 0}
    conflict = "DO UPDATE SET label = EXCLUDED.label, aliases = EXCLUDED.aliases" if overwrite else "DO NOTHING"
    category_conflict = "DO UPDATE SET label = EXCLUDED.label" if overwrite else "DO NOTHING"
    with engine.begin() as conn:
        exercise_rows = conn.execute(
            text("SELECT id, name, aliases FROM global_exercises ORDER BY id")
        ).mappings().all()
        exercise_payload: list[dict[str, Any]] = []
        for row in exercise_rows:
            aliases = row["aliases"] if isinstance(row["aliases"], list) else []
            for language in SUPPORTED_CATALOG_LANGUAGES:
                exercise_payload.append(
                    {
                        "exercise_id": int(row["id"]),
                        "language_tag": language,
                        "label": translate_catalog_label(row["name"], language),
                        "aliases": [translate_catalog_label(alias, language) for alias in aliases],
                    }
                )
        if exercise_payload:
            result = conn.execute(
                text(
                    f"""
                    INSERT INTO global_exercise_labels (exercise_id, language_tag, label, aliases)
                    VALUES (:exercise_id, :language_tag, :label, :aliases)
                    ON CONFLICT (exercise_id, language_tag) {conflict}
                    """
                ),
                exercise_payload,
            )
            counts["global_exercise_labels"] = result.rowcount or 0

        food_rows = conn.execute(
            text(
                """
                SELECT fi.food_id, fi.food_name
                FROM food_items fi
                ORDER BY fi.food_id
                """
            )
        ).mappings().all()
        food_payload: list[dict[str, Any]] = []
        for row in food_rows:
            for language in SUPPORTED_CATALOG_LANGUAGES:
                food_payload.append(
                    {
                        "food_id": int(row["food_id"]),
                        "language_tag": language,
                        "label": translate_catalog_label(row["food_name"], language),
                        "aliases": [],
                    }
                )
        if food_payload:
            result = conn.execute(
                text(
                    f"""
                    INSERT INTO food_item_labels (food_id, language_tag, label, aliases)
                    VALUES (:food_id, :language_tag, :label, :aliases)
                    ON CONFLICT (food_id, language_tag) {conflict}
                    """
                ),
                food_payload,
            )
            counts["food_item_labels"] = result.rowcount or 0

        category_rows = conn.execute(
            text("SELECT category_id, category_name FROM food_categories ORDER BY category_id")
        ).mappings().all()
        category_payload: list[dict[str, Any]] = []
        for row in category_rows:
            for language in SUPPORTED_CATALOG_LANGUAGES:
                category_payload.append(
                    {
                        "category_id": int(row["category_id"]),
                        "language_tag": language,
                        "label": translate_category_label(row["category_name"], language),
                    }
                )
        if category_payload:
            result = conn.execute(
                text(
                    f"""
                    INSERT INTO food_category_labels (category_id, language_tag, label)
                    VALUES (:category_id, :language_tag, :label)
                    ON CONFLICT (category_id, language_tag) {category_conflict}
                    """
                ),
                category_payload,
            )
            counts["food_category_labels"] = result.rowcount or 0
    return counts


def validate_catalog_label_coverage(engine: Engine) -> dict[str, int]:
    with engine.begin() as conn:
        expected_exercises = (conn.execute(text("SELECT COUNT(*) FROM global_exercises")).scalar() or 0) * len(
            SUPPORTED_CATALOG_LANGUAGES
        )
        expected_foods = (conn.execute(text("SELECT COUNT(*) FROM food_items")).scalar() or 0) * len(
            SUPPORTED_CATALOG_LANGUAGES
        )
        expected_categories = (conn.execute(text("SELECT COUNT(*) FROM food_categories")).scalar() or 0) * len(
            SUPPORTED_CATALOG_LANGUAGES
        )
        actual_exercises = conn.execute(text("SELECT COUNT(*) FROM global_exercise_labels")).scalar() or 0
        actual_foods = conn.execute(text("SELECT COUNT(*) FROM food_item_labels")).scalar() or 0
        actual_categories = conn.execute(text("SELECT COUNT(*) FROM food_category_labels")).scalar() or 0
    return {
        "expected_exercise_labels": int(expected_exercises),
        "actual_exercise_labels": int(actual_exercises),
        "expected_food_item_labels": int(expected_foods),
        "actual_food_item_labels": int(actual_foods),
        "expected_food_category_labels": int(expected_categories),
        "actual_food_category_labels": int(actual_categories),
    }
