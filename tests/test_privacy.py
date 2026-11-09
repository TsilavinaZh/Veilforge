import re
from pathlib import Path

from veilforge.detection import Detector
from veilforge.vault import Vault

def test_rules_cover_secret_card_and_mail():
    kinds={x.kind for x in Detector().detect("Email a@b.com; key sk_abcdefghijklmnopqrstuvwxyz; card 4242 4242 4242 4242")}
    assert {"EMAIL","SECRET","CREDIT_CARD"} <= kinds

def test_password_address_and_bank_detection():
    text=("Mot de passe du VPN : Blue-River-77-Xk. pwd= staging_9f31ab77. "
          "Livraison au 24 rue des Oliviers, 69001 Lyon. "
          "Compte n° 123456789012, RIB FR1420041010050500013M02606.")
    kinds={x.kind for x in Detector().detect(text)}
    assert {"PASSWORD","ADDRESS","BANK_ACCOUNT","IBAN"} <= kinds

def test_jwt_and_git_prefix_keys_are_secret():
    text=("JWT : eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFubmFifQ"
          ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c et clé ghp_ABCDEFGHijklmnopqrstuvwxyz123456")
    assert "SECRET" in {x.kind for x in Detector().detect(text)}

def test_name_after_title_is_masked_whole():
    hits=Detector().detect("Titulaire : Mme Claire Dubont, joignable au service")
    persons=[h.value for h in hits if h.kind=="PERSON"]
    assert persons==["Claire Dubont"]

def test_round_trip_and_stable_mapping():
    # Each session is isolated even when a shared local vault is used.
    v=Vault(); masked,sid,_=v.mask("mail ana@example.com then ana@example.com")
    assert masked.count("[[EMAIL_001]]")==2
    assert v.unmask(masked,sid)[0]=="mail ana@example.com then ana@example.com"

def test_unknown_tokens_are_preserved():
    v=Vault(); sid=v.session(); text,unknown=v.unmask("x [[EMAIL_999]]",sid)
    assert text.endswith("[[EMAIL_999]]") and unknown

def _demo_examples() -> list[str]:
    # Les exemples affichés dans la page d'accueil doivent toujours revenir à l'identique.
    src=(Path(__file__).resolve().parents[1]/"web"/"app.js").read_text(encoding="utf-8")
    block=src.split("const DEMO_EXAMPLES = [",1)[1].split("\n];",1)[0]
    examples=[]
    for chunk in re.split(r"',\s*\n\s*\n", block):
        if chunk.count("'")%2: chunk+="'"
        literals=re.findall(r"'([^']*)'", chunk)
        if literals: examples.append("".join(literals))
    return examples

def test_every_demo_example_round_trips():
    examples=_demo_examples()
    assert len(examples)>=5, f"exemples lus : {len(examples)}"
    for text in examples:
        v=Vault(); masked,sid,entities=v.mask(text)
        assert entities, text
        # chaque entité renvoie ses positions exactes dans le texte d'origine
        for e in entities:
            assert text[e["start"]:e["end"]]==e["value"], (e, text)
        assert v.unmask(masked,sid)[0]==text, text
