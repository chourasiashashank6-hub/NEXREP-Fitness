from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

MealTypeLiteral = Literal["Breakfast", "Lunch", "Dinner", "Snack", "Pre_Workout", "Post_Workout"]


class DailyLogEnsureRequest(BaseModel):
    """Optional client calendar date (YYYY-MM-DD). Defaults to server UTC today."""

    date: str | None = None


class MealCreateRequest(BaseModel):
    log_date: str | None = None
    meal_type: MealTypeLiteral
    source_type: Literal["database", "camera_ai"] = "database"
    food_name: str = Field(..., min_length=1, max_length=200)
    quantity_g: Decimal = Field(..., gt=0)
    calories_per_100g: Decimal = Field(..., ge=0)
    protein_per_100g: Decimal = Field(default=Decimal("0"), ge=0)
    carbs_per_100g: Decimal = Field(default=Decimal("0"), ge=0)
    fat_per_100g: Decimal = Field(default=Decimal("0"), ge=0)
    fiber_per_100g: Decimal = Field(default=Decimal("0"), ge=0)


class MealUpdateRequest(BaseModel):
    quantity_g: Decimal = Field(..., gt=0)


class WaterPatchRequest(BaseModel):
    water_l: Decimal = Field(..., ge=0)
    date: str | None = None


class FoodLookupRequest(BaseModel):
    food_id: int | None = Field(default=None, gt=0)
    food_name: str | None = Field(default=None, min_length=1, max_length=200)
    quantity_g: Decimal = Field(..., gt=0)


class FoodImageAnalyzeRequest(BaseModel):
    base64: str = Field(..., min_length=20)
    mime_type: str | None = Field(default="image/jpeg", min_length=3, max_length=100)


class AIFoodMealCreateRequest(BaseModel):
    log_date: str | None = None
    meal_type: MealTypeLiteral
    food_name: str = Field(..., min_length=1, max_length=200)
    quantity_g: Decimal = Field(..., gt=0)
    calories: Decimal = Field(default=Decimal("0"), ge=0)
    protein: Decimal = Field(default=Decimal("0"), ge=0)
    carbs: Decimal = Field(default=Decimal("0"), ge=0)
    fat: Decimal = Field(default=Decimal("0"), ge=0)
    fibre: Decimal = Field(default=Decimal("0"), ge=0)
    confidence: str | None = Field(default="medium", min_length=1, max_length=16)
    estimated_serving_size: str | None = Field(default=None, max_length=120)
