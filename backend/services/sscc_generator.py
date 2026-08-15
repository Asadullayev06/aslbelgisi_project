"""GS1 SSCC-18 generator — port of backend.py::SSCCGenerator.

Structure (18 digits):
    [ext(1)] [GS1 prefix(N)] [serial ref(16-N)] [check(1)]
Extension is usually "0". Prefix is either the company GCP or the zero-padded
9-digit INN (Uzbek business rule). Serial ref fills the remaining space up
to 17 total digits, then a Mod-10 check digit is appended.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SSCCResult:
    sscc: str
    extension_digit: str = "0"
    gs1_prefix: str = ""
    serial_ref: str = ""
    check_digit: str = ""
    is_valid: bool = True


class SSCCGenerator:
    def __init__(self, gs1_prefix: str, extension_digit: str = "0"):
        if not gs1_prefix or not gs1_prefix.isdigit():
            raise ValueError(f"GS1 prefix raqamli bo'lishi kerak: '{gs1_prefix}'")
        if not (4 <= len(gs1_prefix) <= 12):
            raise ValueError(f"GS1 prefix uzunligi 4-12 raqam bo'lishi kerak (siz {len(gs1_prefix)})")
        if len(extension_digit) != 1 or not extension_digit.isdigit():
            raise ValueError(f"Extension digit 0-9 dan bitta raqam: '{extension_digit}'")
        self.gs1_prefix = gs1_prefix
        self.extension_digit = extension_digit
        self._serial_len = 16 - len(gs1_prefix)
        if self._serial_len < 1:
            raise ValueError("GS1 prefix juda uzun — serial uchun joy qolmadi")
        self._max_serial = 10 ** self._serial_len

    @staticmethod
    def gs1_check_digit(digits_17: str) -> str:
        if len(digits_17) != 17 or not digits_17.isdigit():
            raise ValueError(f"17 raqam kutildi: '{digits_17}'")
        total = 0
        for i, ch in enumerate(digits_17):
            n = int(ch)
            total += n * 3 if (17 - i) % 2 == 1 else n
        return str((10 - (total % 10)) % 10)

    def generate(self, sequence: int) -> SSCCResult:
        if sequence < 0 or sequence >= self._max_serial:
            raise ValueError(f"Sequence {sequence} chegaradan tashqarida [0, {self._max_serial})")
        serial = str(sequence).zfill(self._serial_len)
        body = self.extension_digit + self.gs1_prefix + serial  # 17 digits
        check = self.gs1_check_digit(body)
        return SSCCResult(
            sscc=body + check,
            extension_digit=self.extension_digit,
            gs1_prefix=self.gs1_prefix,
            serial_ref=serial,
            check_digit=check,
        )

    def generate_batch(self, start: int, count: int) -> list[SSCCResult]:
        return [self.generate(start + i) for i in range(count)]

    @staticmethod
    def to_parent_package_code(sscc: str) -> str:
        """Return AI(00) + SSCC-18 (20 chars) — the form ASL wants in
        aggregationUnits.unitSerialNumber."""
        n = str(sscc).strip()
        if len(n) == 20 and n.startswith("00") and n.isdigit():
            return n
        if len(n) == 18 and n.isdigit():
            return f"00{n}"
        raise ValueError(f"SSCC-18 yoki AI(00)+SSCC kutildi: '{sscc}'")

    @staticmethod
    def extract_sscc(code: str) -> str:
        n = str(code).strip()
        if len(n) == 20 and n.startswith("00") and n.isdigit():
            return n[2:]
        if len(n) == 18 and n.isdigit():
            return n
        raise ValueError(f"SSCC-18 yoki AI(00)+SSCC kutildi: '{code}'")

    @staticmethod
    def validate_sscc(sscc: str) -> tuple[bool, str]:
        try:
            s = SSCCGenerator.extract_sscc(sscc)
        except ValueError as e:
            return False, str(e)
        if not s.isdigit() or len(s) != 18:
            return False, f"SSCC 18 ta raqam bo'lishi kerak (siz {len(s)})"
        expected = SSCCGenerator.gs1_check_digit(s[:17])
        if s[17] != expected:
            return False, f"Noto'g'ri check digit: kutilgan {expected}, kelgan {s[17]}"
        return True, ""

    @classmethod
    def from_inn(cls, inn: str, use_gcp: bool = False, gcp_prefix: str = "",
                 extension_digit: str = "0") -> "SSCCGenerator":
        """Factory: if `use_gcp`, use the passed GCP prefix; otherwise pad the
        INN to 9 digits and use that. Same rule the Streamlit app uses."""
        if use_gcp and gcp_prefix:
            prefix = gcp_prefix.strip().replace(" ", "")
        else:
            prefix = inn.strip().replace(" ", "").zfill(9)
        return cls(gs1_prefix=prefix, extension_digit=extension_digit)
