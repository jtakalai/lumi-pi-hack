from solution import reverse_words

def test_reverse_words():
    assert reverse_words("hello world") == "world hello"
    assert reverse_words("a b c") == "c b a"
