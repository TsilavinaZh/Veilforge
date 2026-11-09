from veilforge.detection import Detector
from veilforge.vault import Vault

def test_rules_cover_secret_card_and_mail():
    kinds={x.kind for x in Detector().detect("Email a@b.com; key sk_abcdefghijklmnopqrstuvwxyz; card 4242 4242 4242 4242")}
    assert {"EMAIL","SECRET","CREDIT_CARD"} <= kinds

def test_round_trip_and_stable_mapping():
    # Each session is isolated even when a shared local vault is used.
    v=Vault(); masked,sid,_=v.mask("mail ana@example.com then ana@example.com")
    assert masked.count("[[EMAIL_001]]")==2
    assert v.unmask(masked,sid)[0]=="mail ana@example.com then ana@example.com"

def test_unknown_tokens_are_preserved():
    v=Vault(); sid=v.session(); text,unknown=v.unmask("x [[EMAIL_999]]",sid)
    assert text.endswith("[[EMAIL_999]]") and unknown
