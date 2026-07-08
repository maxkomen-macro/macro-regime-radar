from datetime import date
from src.utils.dates import get_end_date, get_start_date

def test_start_date_normal_day():
    assert get_start_date(30, today=date(2026, 7, 7)) == "1996-07-07"

def test_start_date_feb29_to_non_leap_year():
    assert get_start_date(30, today=date(2024, 2, 29)) == "1994-02-28"

def test_start_date_feb29_to_leap_year():
    assert get_start_date(4, today=date(2024, 2, 29)) == "2020-02-29"

def test_start_date_defaults_to_today():
    assert get_start_date(1) < get_end_date()
