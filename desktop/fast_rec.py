"""Decode indexed recognizer outputs without copying the full character probability table."""
class IndexedSession:
    def __init__(self, session):
        self.session = session
        self.input_name = session.get_inputs()[0].name

    def __call__(self, images):
        return self.session.run(['idx', 'prob'], {self.input_name: images})


class IndexedDecoder:
    def __init__(self, keys=None, decoder=None):
        from rapidocr.ch_ppocr_rec.utils import CTCLabelDecode
        # The compact model retains the original metadata dictionary; use its
        # matching compact dictionary, including CTC blank and space tokens.
        self.decoder = decoder or CTCLabelDecode(character_path=keys)

    def __call__(self, predictions, return_word_box=False, **kwargs):
        indices, probabilities = predictions
        return self.decoder.decode(indices, probabilities, return_word_box,
                                   kwargs.get('wh_ratio_list', (1.0,)),
                                   kwargs.get('max_wh_ratio', 1.0), remove_duplicate=True)


def attach_indexed_recognizer(engine, keys=None):
    rec = engine._load_rec_model()
    rec.session = IndexedSession(rec.session.session)
    rec.postprocess_op = IndexedDecoder(keys, rec.postprocess_op if keys is None else None)
