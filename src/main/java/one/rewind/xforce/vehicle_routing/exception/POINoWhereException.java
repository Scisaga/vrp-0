package one.rewind.xforce.vehicle_routing.exception;

public class POINoWhereException extends Exception {

    public POINoWhereException(){
        super();
    }

    public POINoWhereException(String msg) {
        super(msg);
    }
}
